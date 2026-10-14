import type { CampaignLeadEligibility, CampaignLeadStatus } from '@docline/db';
import { systemActor, type Actor } from '../../../shared/actor';
import { BusinessRuleError, DomainError } from '../../../shared/errors';
import { auditData, toJson, type CoreDeps } from '../../../shared/use-case';
import { BULK_LIMIT, compileLeadSelection } from '../../leads';
import { campaignBuildJob } from '../contracts/schemas';
import { assignVariants, planDistribution } from '../domain/distribution';
import { countReasons } from '../domain/eligibility';
import { evaluateLeads, type LeadEligibility } from '../infra/eligibility';
import { storedSelection } from './campaigns';

/** Leads avaliados por transação (o gate é lido lead a lead). */
const EVALUATION_CHUNK = 250;
const INSERT_CHUNK = 1000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/**
 * Job `campaign.build` (F10-01, F10-02, F10-03): congela o retrato do filtro
 * (até BULK_LIMIT leads), avalia a elegibilidade de cada lead com os motivos,
 * distribui os aptos entre os SDRs e sorteia as variantes. Refazer a montagem
 * substitui o retrato anterior. Falha volta a campanha ao rascunho com o erro
 * à vista (e na auditoria); nada é enviado a ninguém.
 */
export async function runCampaignBuild(deps: CoreDeps, data: unknown) {
  const { campaignId } = campaignBuildJob.parse(data);
  const actor = systemActor('campaign.build');
  const campaign = await deps.db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      sdrs: { select: { userId: true } },
      variants: { select: { id: true, label: true } },
      createdBy: { select: { id: true, role: true, status: true, teamId: true } },
    },
  });
  if (!campaign || campaign.status !== 'BUILDING') return { status: 'skipped' as const };
  const now = deps.clock.now();
  try {
    // "Meus leads" no filtro é de quem criou a campanha.
    const filterActor: Actor =
      campaign.createdBy?.status === 'ACTIVE'
        ? { kind: 'user', ...campaign.createdBy }
        : systemActor('campaign.build');
    const where = compileLeadSelection(filterActor, storedSelection(campaign.filterDefinition));
    const selected = await deps.db.lead.findMany({
      where,
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: BULK_LIMIT + 1,
      select: { id: true },
    });
    if (selected.length === 0) {
      throw new BusinessRuleError(
        'O filtro não traz nenhum lead. Ajuste a seleção e monte de novo.',
      );
    }
    if (selected.length > BULK_LIMIT) {
      throw new BusinessRuleError(
        `O filtro traz mais de ${BULK_LIMIT.toLocaleString('pt-BR')} leads. Refine a seleção (cidade, etapa, score…) e monte de novo.`,
      );
    }

    const sdrIds = campaign.sdrs.map((s) => s.userId);
    const info = {
      id: campaign.id,
      channel: campaign.channel as 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'INSTAGRAM',
      minDaysSinceLastContact: campaign.minDaysSinceLastContact,
      sdrIds,
    };
    const evaluations: LeadEligibility[] = [];
    for (const chunk of chunks(
      selected.map((l) => l.id),
      EVALUATION_CHUNK,
    )) {
      evaluations.push(
        ...(await deps.db.$transaction((tx) => evaluateLeads(tx, info, chunk, now), {
          timeout: 60_000,
        })),
      );
    }

    const eligible = evaluations.filter((e) => e.reasons.length === 0);
    const distribution = planDistribution(
      eligible.map((e) => ({ leadId: e.leadId, ownerId: e.ownerId, priority: e.priority })),
      sdrIds,
    );
    const variants = assignVariants(
      eligible.flatMap((e) => {
        const assignedTo = distribution.get(e.leadId);
        return assignedTo ? [{ leadId: e.leadId, assignedTo, priority: e.priority }] : [];
      }),
      campaign.variants,
    );
    const rows = evaluations.map((e) => {
      const assignedTo = distribution.get(e.leadId) ?? null;
      const apt = e.reasons.length === 0 && assignedTo !== null;
      return {
        campaignId: campaign.id,
        leadId: e.leadId,
        eligibility: (apt ? 'ELIGIBLE' : 'INELIGIBLE') as CampaignLeadEligibility,
        ineligibilityReasons: e.reasons,
        // Inapto já nasce "não liberado", com os motivos.
        status: (apt ? 'PENDING' : 'SKIPPED') as CampaignLeadStatus,
        assignedToId: apt ? assignedTo : null,
        variantId: apt ? (variants.get(e.leadId) ?? null) : null,
        priority: e.priority,
        addedAt: now,
      };
    });
    const perSdr: Record<string, number> = {};
    const perVariant: Record<string, number> = {};
    for (const row of rows) {
      if (row.assignedToId) perSdr[row.assignedToId] = (perSdr[row.assignedToId] ?? 0) + 1;
      if (row.variantId) perVariant[row.variantId] = (perVariant[row.variantId] ?? 0) + 1;
    }
    const stats = {
      selected: rows.length,
      eligible: rows.filter((r) => r.eligibility === 'ELIGIBLE').length,
      ineligible: rows.filter((r) => r.eligibility === 'INELIGIBLE').length,
      reasons: countReasons(rows.map((r) => ({ reasons: r.ineligibilityReasons }))),
      perSdr,
      perVariant,
    };

    const outcome = await deps.db.$transaction(
      async (tx) => {
        // Só grava se ninguém mexeu na campanha durante a avaliação.
        const current = await tx.campaign.findUnique({
          where: { id: campaign.id },
          select: { status: true, version: true },
        });
        if (current?.status !== 'BUILDING' || current.version !== campaign.version) {
          return 'stale' as const;
        }
        await tx.campaignLead.deleteMany({ where: { campaignId: campaign.id } });
        for (const chunk of chunks(rows, INSERT_CHUNK)) {
          await tx.campaignLead.createMany({ data: chunk });
        }
        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            status: 'READY',
            snapshotAt: now,
            buildStats: toJson(stats),
            buildError: null,
            version: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            ...auditData(
              actor,
              {},
              {
                action: 'campaign.build_completed',
                entityType: 'campaign',
                entityId: campaign.id,
                changes: { status: ['BUILDING', 'READY'] },
                metadata: {
                  selected: stats.selected,
                  eligible: stats.eligible,
                  ineligible: stats.ineligible,
                },
              },
            ),
            occurredAt: now,
          },
        });
        return 'ready' as const;
      },
      { timeout: 60_000 },
    );
    return { status: outcome, ...(outcome === 'ready' ? { stats } : {}) };
  } catch (error) {
    const known = error instanceof DomainError;
    if (!known) deps.logger.error({ err: error, campaignId }, 'Falha na montagem da campanha');
    const message = known
      ? error.message
      : 'Falha inesperada na montagem. Tente de novo; se persistir, avise o administrador.';
    const failed = await deps.db.campaign.updateMany({
      where: { id: campaign.id, status: 'BUILDING' },
      data: { status: 'DRAFT', buildError: message, version: { increment: 1 } },
    });
    if (failed.count > 0) {
      await deps.db.auditLog.create({
        data: {
          ...auditData(
            actor,
            {},
            {
              action: 'campaign.build_failed',
              entityType: 'campaign',
              entityId: campaign.id,
              changes: { status: ['BUILDING', 'DRAFT'] },
              metadata: { error: message },
            },
          ),
          occurredAt: now,
        },
      });
    }
    return { status: 'failed' as const, error: message };
  }
}
