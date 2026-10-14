import { z } from 'zod';
import { systemActor } from '../../../shared/actor';
import { DEFAULT_TIME_ZONE, localDayBounds, localParts } from '../../../shared/calendar';
import { defineUseCase, type CoreDeps } from '../../../shared/use-case';
import { enrollInCadence } from '../../cadence';
import { auditLead, changeOwner, LEAD_EVENTS, recordLeadEvent } from '../../leads';
import { loadContactRules } from '../../settings';
import { releaseQuota } from '../domain/distribution';
import { ATTRIBUTION_DAYS } from '../domain/funnel';
import { evaluateLeads } from '../infra/eligibility';
import { refreshMilestones } from '../infra/milestones';
import { campaignAction } from './campaigns';

const DAY_MS = 86_400_000;

type ReleaseOutcome = 'released' | 'skipped' | 'quota' | 'stopped';

/**
 * Libera um lead da campanha para a cadência, na própria transação: confere
 * de novo a situação da campanha, a cota do dia do SDR e a elegibilidade
 * (inclusive o gate do canal); inapto agora fica "não liberado" com os
 * motivos. Lead do pool passa a ser do SDR (atribuição "Campanha"). A trava
 * por campanha impede que duas rodadas ao mesmo tempo passem da cota.
 */
const releaseCampaignLead = defineUseCase({
  name: 'campaigns.release',
  access: 'campaign.manage',
  input: z.object({ campaignId: z.uuid(), leadId: z.uuid() }),
  async run(ctx, input): Promise<ReleaseOutcome> {
    await ctx.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:${input.campaignId}`}))`;
    const campaign = await ctx.tx.campaign.findUnique({
      where: { id: input.campaignId },
      select: {
        id: true,
        name: true,
        status: true,
        channel: true,
        cadenceId: true,
        dailyContactLimit: true,
        minDaysSinceLastContact: true,
        sdrs: { select: { userId: true } },
      },
    });
    if (!campaign || campaign.status !== 'ACTIVE') return 'stopped';
    const key = { campaignId_leadId: { campaignId: campaign.id, leadId: input.leadId } };
    const row = await ctx.tx.campaignLead.findUnique({
      where: key,
      select: { status: true, assignedToId: true, variant: { select: { label: true } } },
    });
    if (!row || row.status !== 'PENDING' || !row.assignedToId) return 'skipped';

    const sdr = await ctx.tx.user.findUnique({
      where: { id: row.assignedToId },
      select: { id: true, status: true, timezone: true },
    });
    if (!sdr || sdr.status !== 'ACTIVE') return 'quota';
    const day = localDayBounds(ctx.now, sdr.timezone || DEFAULT_TIME_ZONE);
    const releasedToday = await ctx.tx.campaignLead.count({
      where: {
        campaignId: campaign.id,
        assignedToId: sdr.id,
        releasedAt: { gte: day.start, lt: day.end },
      },
    });
    if (releaseQuota(campaign.dailyContactLimit, releasedToday) === 0) return 'quota';

    const [evaluation] = await evaluateLeads(
      ctx.tx,
      {
        id: campaign.id,
        channel: campaign.channel as 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'INSTAGRAM',
        minDaysSinceLastContact: campaign.minDaysSinceLastContact,
        sdrIds: campaign.sdrs.map((s) => s.userId),
      },
      [input.leadId],
      ctx.now,
    );
    if (!evaluation) return 'skipped';
    if (evaluation.reasons.length > 0) {
      await ctx.tx.campaignLead.update({
        where: key,
        data: { status: 'SKIPPED', ineligibilityReasons: evaluation.reasons },
      });
      return 'skipped';
    }

    let ownerId = evaluation.ownerId;
    if (ownerId === null) {
      // Trava contra um SDR puxar o mesmo lead do pool ao mesmo tempo.
      const taken = await ctx.tx.lead.updateMany({
        where: { id: input.leadId, ownerId: null },
        data: { ownerId: sdr.id },
      });
      if (taken.count === 0) return 'skipped';
      await changeOwner(
        ctx,
        { id: input.leadId, ownerId: null },
        sdr.id,
        'CAMPAIGN',
        `Campanha "${campaign.name}".`,
      );
      ownerId = sdr.id;
    }
    const { enrollmentId } = await enrollInCadence(ctx, input.leadId, {
      cadenceId: campaign.cadenceId,
      campaignId: campaign.id,
    });
    await ctx.tx.campaignLead.update({
      where: key,
      data: { status: 'RELEASED', releasedAt: ctx.now, enrollmentId, assignedToId: ownerId },
    });
    await recordLeadEvent(ctx, input.leadId, LEAD_EVENTS.campaignReleased, {
      payload: { campaign: campaign.name, variant: row.variant?.label ?? null },
      subject: { type: 'campaign', id: campaign.id },
    });
    await auditLead(ctx, input.leadId, 'campaign.release', {
      subjectId: campaign.id,
      metadata: { campaign: campaign.name, assignedToId: ownerId },
    });
    return 'released';
  },
});

const tickInput = z.object({ campaignId: z.uuid().optional() });

/**
 * Job `campaign.tick` (de hora em hora, e logo após ativar ou retomar):
 * conclui as campanhas cujo fim passou, libera até o limite diário de cada SDR
 * (nos dias de expediente das regras de contato, no fuso do SDR), na ordem de
 * prioridade, e atualiza os marcos do funil das campanhas com liberações na
 * janela de atribuição. Liberar não envia nada: cria a inscrição na cadência
 * e a tarefa do primeiro passo na Minha Fila do SDR.
 */
export async function runCampaignTick(deps: CoreDeps, data: unknown = {}) {
  const input = tickInput.parse(data ?? {});
  const actor = systemActor('campaign.tick');
  const now = deps.clock.now();
  const only = input.campaignId ? { id: input.campaignId } : {};
  const result = { completed: 0, released: 0, skipped: 0, errors: 0 };

  const expired = await deps.db.campaign.findMany({
    where: { ...only, status: { in: ['ACTIVE', 'PAUSED'] }, endsAt: { lte: now } },
    select: { id: true, version: true },
  });
  for (const campaign of expired) {
    try {
      await campaignAction(deps, actor, {
        campaignId: campaign.id,
        action: 'complete',
        version: campaign.version,
      });
      result.completed += 1;
    } catch (error) {
      result.errors += 1;
      deps.logger.error({ err: error, campaignId: campaign.id }, 'Falha ao concluir campanha');
    }
  }

  const rules = await loadContactRules(deps.db);
  const active = await deps.db.campaign.findMany({
    where: { ...only, status: 'ACTIVE', OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    select: {
      id: true,
      dailyContactLimit: true,
      sdrs: { select: { user: { select: { id: true, status: true, timezone: true } } } },
    },
  });
  for (const campaign of active) {
    let stopped = false;
    for (const { user: sdr } of campaign.sdrs) {
      if (stopped) break;
      if (sdr.status !== 'ACTIVE') continue;
      const timeZone = sdr.timezone || DEFAULT_TIME_ZONE;
      if (!rules.workDays.includes(localParts(now, timeZone).weekday)) continue;
      const day = localDayBounds(now, timeZone);
      const releasedToday = await deps.db.campaignLead.count({
        where: {
          campaignId: campaign.id,
          assignedToId: sdr.id,
          releasedAt: { gte: day.start, lt: day.end },
        },
      });
      let quota = releaseQuota(campaign.dailyContactLimit, releasedToday);
      const attempted: string[] = [];
      while (quota > 0 && !stopped) {
        const candidates = await deps.db.campaignLead.findMany({
          where: {
            campaignId: campaign.id,
            assignedToId: sdr.id,
            status: 'PENDING',
            ...(attempted.length > 0 ? { leadId: { notIn: attempted } } : {}),
          },
          orderBy: [{ priority: 'desc' }, { leadId: 'asc' }],
          take: quota + 20,
          select: { leadId: true },
        });
        if (candidates.length === 0) break;
        for (const { leadId } of candidates) {
          if (quota === 0) break;
          attempted.push(leadId);
          let outcome: ReleaseOutcome;
          try {
            outcome = await releaseCampaignLead(deps, actor, {
              campaignId: campaign.id,
              leadId,
            });
          } catch (error) {
            // Um lead com problema não trava os outros; fica aguardando.
            result.errors += 1;
            deps.logger.error(
              { err: error, campaignId: campaign.id, leadId },
              'Falha ao liberar lead da campanha',
            );
            continue;
          }
          if (outcome === 'released') {
            result.released += 1;
            quota -= 1;
          } else if (outcome === 'skipped') {
            result.skipped += 1;
          } else if (outcome === 'quota') {
            quota = 0;
          } else {
            stopped = true;
            break;
          }
        }
      }
    }
  }

  const live = await deps.db.campaign.findMany({
    where: {
      ...only,
      status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] },
      leads: { some: { releasedAt: { gte: new Date(now.getTime() - ATTRIBUTION_DAYS * DAY_MS) } } },
    },
    select: { id: true },
  });
  for (const campaign of live) {
    await deps.db.$transaction((tx) => refreshMilestones(tx, [campaign.id]), { timeout: 60_000 });
  }
  return result;
}
