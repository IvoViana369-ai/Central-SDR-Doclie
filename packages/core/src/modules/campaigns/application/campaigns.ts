import { Prisma, type CampaignStatus } from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import { DEFAULT_TIME_ZONE, localDayBounds } from '../../../shared/calendar';
import { diffFields } from '../../../shared/diff';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { compileLeadSelection, requireLeadInScope, type FilterNode } from '../../leads';
import {
  campaignActionInput,
  campaignIdInput,
  createCampaignInput,
  leadCampaignsInput,
  listCampaignLeadsInput,
  listCampaignsInput,
  removeCampaignLeadInput,
  STRUCTURE_FIELDS,
  updateCampaignInput,
} from '../contracts/schemas';
import { countReasons } from '../domain/eligibility';
import { buildFunnel, compareVariants, rate } from '../domain/funnel';
import {
  availableActions,
  CAMPAIGN_ACTION_LABELS,
  CAMPAIGN_ACTION_TARGET,
  CAMPAIGN_STATUS_LABELS,
  canEditSettings,
  canEditStructure,
  VARIANT_LABELS,
} from '../domain/status';
import { EMPTY_FUNNEL, funnelCounts, refreshMilestones } from '../infra/milestones';

/** Seleção guardada na campanha (como numa visão salva). */
export interface StoredSelection {
  filter?: FilterNode | null;
  q?: string | null;
}

function selectionJson(selection: { filter?: FilterNode; q?: string }) {
  return toJson({ filter: selection.filter ?? null, q: selection.q ?? null });
}

export function storedSelection(value: unknown): { filter?: FilterNode; q?: string } {
  const stored = (value ?? {}) as StoredSelection;
  return { filter: stored.filter ?? undefined, q: stored.q ?? undefined };
}

async function requireCampaign(ctx: UseCaseContext, campaignId: string) {
  const campaign = await ctx.tx.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError('Campanha não encontrada.');
  return campaign;
}

function checkVersion(current: { version: number }, version: number) {
  if (current.version !== version) {
    throw new ConflictError(
      'A campanha foi alterada por outra pessoa. Recarregue e tente de novo.',
    );
  }
}

/** Confere responsável, SDRs, cadência, abordagens e o filtro antes de gravar. */
async function validateReferences(
  ctx: UseCaseContext,
  refs: {
    ownerId?: string;
    sdrIds?: string[];
    cadenceId?: string | null;
    approachIds?: string[];
    selection?: { filter?: FilterNode; q?: string };
  },
) {
  if (refs.ownerId) {
    const owner = await ctx.tx.user.count({
      where: { id: refs.ownerId, status: 'ACTIVE', role: { in: ['ADMIN', 'MANAGER'] } },
    });
    if (owner === 0) {
      throw new ValidationError([
        { path: 'ownerId', message: 'O responsável precisa ser um gestor ou administrador ativo.' },
      ]);
    }
  }
  if (refs.sdrIds) {
    // O Comercial recebe oportunidades; quem prospecta é SDR (ou gestor/ADMIN).
    const found = await ctx.tx.user.count({
      where: {
        id: { in: refs.sdrIds },
        status: 'ACTIVE',
        role: { in: ['SDR', 'MANAGER', 'ADMIN'] },
      },
    });
    if (found !== refs.sdrIds.length) {
      throw new ValidationError([
        { path: 'sdrIds', message: 'Há pessoa inativa ou do Comercial entre os SDRs da campanha.' },
      ]);
    }
  }
  if (refs.cadenceId) {
    const cadence = await ctx.tx.cadence.count({
      where: { id: refs.cadenceId, active: true, steps: { some: {} } },
    });
    if (cadence === 0) {
      throw new ValidationError([
        { path: 'cadenceId', message: 'Cadência não encontrada, inativa ou sem passos.' },
      ]);
    }
  }
  if (refs.approachIds && refs.approachIds.length > 0) {
    const found = await ctx.tx.approach.count({
      where: { id: { in: refs.approachIds }, active: true },
    });
    if (found !== refs.approachIds.length) {
      throw new ValidationError([
        { path: 'approachIds', message: 'Há abordagem inativa ou inexistente.' },
      ]);
    }
  }
  // Valida o filtro agora: a montagem não pode quebrar depois.
  if (refs.selection) compileLeadSelection(ctx.actor, refs.selection);
}

function checkMergedDates(startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new ValidationError([{ path: 'endsAt', message: 'O fim precisa ser depois do início.' }]);
  }
}

/** Nova campanha em rascunho (F10-01): nada é selecionado até a montagem. */
export const createCampaign = defineUseCase({
  name: 'campaigns.create',
  access: 'campaign.manage',
  input: createCampaignInput,
  async run(ctx, input) {
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const ownerId = input.ownerId ?? actorId;
    if (!ownerId) throw new BusinessRuleError('Informe o responsável pela campanha.');
    await validateReferences(ctx, {
      ownerId,
      sdrIds: input.sdrIds,
      cadenceId: input.cadenceId,
      approachIds: input.approachIds,
      selection: input.selection,
    });
    const campaign = await ctx.tx.campaign.create({
      data: {
        name: input.name,
        objective: input.objective ?? null,
        status: 'DRAFT',
        filterDefinition: selectionJson(input.selection),
        filterLabel: input.filterLabel ?? null,
        channel: input.channel,
        cadenceId: input.cadenceId ?? null,
        ownerId,
        dailyContactLimit: input.dailyContactLimit,
        minDaysSinceLastContact: input.minDaysSinceLastContact,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        createdById: actorId,
        sdrs: { create: input.sdrIds.map((userId) => ({ userId })) },
        variants: {
          create: input.approachIds.map((approachId, index) => ({
            label: VARIANT_LABELS[index]!,
            approachId,
          })),
        },
      },
    });
    await ctx.audit({
      action: 'campaign.create',
      entityType: 'campaign',
      entityId: campaign.id,
      metadata: {
        name: campaign.name,
        channel: campaign.channel,
        sdrs: input.sdrIds.length,
        variants: input.approachIds.length,
      },
    });
    return { campaignId: campaign.id, version: campaign.version };
  },
});

/**
 * Edita a campanha. A estrutura (filtro, canal, cadência, SDRs, abordagens e
 * frequência) só muda antes de ativar; numa campanha pronta, mudar a
 * estrutura descarta o retrato e ela volta ao rascunho. Nome, objetivo,
 * responsável, limite diário e datas mudam até a conclusão.
 */
export const updateCampaign = defineUseCase({
  name: 'campaigns.update',
  access: 'campaign.manage',
  input: updateCampaignInput,
  async run(ctx, { campaignId, version, ...input }) {
    const current = await requireCampaign(ctx, campaignId);
    checkVersion(current, version);
    if (current.status === 'BUILDING') {
      throw new BusinessRuleError('A campanha está sendo montada. Aguarde terminar para editar.');
    }
    if (!canEditSettings(current.status)) {
      throw new BusinessRuleError('Campanha concluída ou arquivada não muda mais.');
    }
    const structural = STRUCTURE_FIELDS.some((field) => input[field] !== undefined);
    if (structural && !canEditStructure(current.status)) {
      throw new BusinessRuleError(
        'Filtro, canal, cadência, SDRs, abordagens e frequência só mudam antes de ativar a campanha.',
      );
    }
    await validateReferences(ctx, {
      ownerId: input.ownerId,
      sdrIds: input.sdrIds,
      cadenceId: input.cadenceId,
      approachIds: input.approachIds,
      selection: input.selection,
    });
    const startsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt;
    const endsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;
    checkMergedDates(startsAt, endsAt);

    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.objective !== undefined ? { objective: input.objective } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.dailyContactLimit !== undefined
        ? { dailyContactLimit: input.dailyContactLimit }
        : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.cadenceId !== undefined ? { cadenceId: input.cadenceId } : {}),
      ...(input.minDaysSinceLastContact !== undefined
        ? { minDaysSinceLastContact: input.minDaysSinceLastContact }
        : {}),
      ...(input.filterLabel !== undefined ? { filterLabel: input.filterLabel } : {}),
    };
    const changes = diffFields(current, data, [
      'name',
      'objective',
      'ownerId',
      'dailyContactLimit',
      'startsAt',
      'endsAt',
      'channel',
      'cadenceId',
      'minDaysSinceLastContact',
      'filterLabel',
    ]);

    const reset = structural && current.status === 'READY';
    if (reset) {
      await ctx.tx.campaignLead.deleteMany({ where: { campaignId } });
    }
    if (input.sdrIds) {
      await ctx.tx.campaignSdr.deleteMany({ where: { campaignId } });
      await ctx.tx.campaignSdr.createMany({
        data: input.sdrIds.map((userId) => ({ campaignId, userId })),
      });
    }
    if (input.approachIds) {
      await ctx.tx.campaignVariant.deleteMany({ where: { campaignId } });
      await ctx.tx.campaignVariant.createMany({
        data: input.approachIds.map((approachId, index) => ({
          campaignId,
          label: VARIANT_LABELS[index]!,
          approachId,
        })),
      });
    }
    const updated = await ctx.tx.campaign.update({
      where: { id: campaignId },
      data: {
        ...data,
        ...(input.selection ? { filterDefinition: selectionJson(input.selection) } : {}),
        ...(reset ? { status: 'DRAFT', snapshotAt: null, buildStats: Prisma.DbNull } : {}),
        version: { increment: 1 },
      },
    });
    await ctx.audit({
      action: 'campaign.update',
      entityType: 'campaign',
      entityId: campaignId,
      changes,
      metadata: {
        ...(input.selection ? { filterChanged: true } : {}),
        ...(input.sdrIds ? { sdrs: input.sdrIds.length } : {}),
        ...(input.approachIds ? { variants: input.approachIds.length } : {}),
        ...(reset ? { snapshotDiscarded: true } : {}),
      },
    });
    return { campaignId, version: updated.version, status: updated.status };
  },
});

/**
 * Muda a situação da campanha: montar (retrato do filtro, em segundo plano),
 * ativar, pausar, retomar, concluir e arquivar. Ativar e retomar já liberam
 * o lote do dia (job `campaign.tick` da campanha).
 */
export const campaignAction = defineUseCase({
  name: 'campaigns.action',
  access: 'campaign.manage',
  input: campaignActionInput,
  async run(ctx, input) {
    const current = await requireCampaign(ctx, input.campaignId);
    checkVersion(current, input.version);
    const target = CAMPAIGN_ACTION_TARGET[input.action];
    if (!availableActions(current.status).includes(input.action)) {
      throw new BusinessRuleError(
        `Não dá para ${CAMPAIGN_ACTION_LABELS[input.action].toLowerCase()} uma campanha na situação "${CAMPAIGN_STATUS_LABELS[current.status]}".`,
      );
    }

    const data: Prisma.CampaignUpdateInput = { status: target, version: { increment: 1 } };
    if (input.action === 'build') {
      data.buildError = null;
    }
    if (input.action === 'activate' || input.action === 'resume') {
      if (current.endsAt && current.endsAt <= ctx.now) {
        throw new BusinessRuleError('O fim da campanha já passou: ajuste as datas antes.');
      }
      const pending = await ctx.tx.campaignLead.count({
        where: { campaignId: current.id, status: 'PENDING' },
      });
      if (input.action === 'activate' && pending === 0) {
        throw new BusinessRuleError(
          'Nenhum lead apto aguardando liberação: ajuste o filtro e monte de novo.',
        );
      }
      if (input.action === 'activate') data.activatedAt = ctx.now;
    }
    if (input.action === 'complete') data.completedAt = ctx.now;
    if (input.action === 'complete' || input.action === 'archive') {
      // Quem não chegou a ser liberado sai da campanha (não é apagado).
      await ctx.tx.campaignLead.updateMany({
        where: { campaignId: current.id, status: 'PENDING' },
        data: { status: 'REMOVED' },
      });
    }
    const updated = await ctx.tx.campaign.update({ where: { id: current.id }, data });

    if (input.action === 'build') {
      await ctx.deps.jobs.enqueue(
        JOBS.campaignBuild.name,
        { campaignId: current.id },
        { tx: ctx.tx, singletonKey: `campaign-build:${current.id}` },
      );
    }
    if (input.action === 'activate' || input.action === 'resume') {
      await ctx.deps.jobs.enqueue(
        JOBS.campaignTick.name,
        { campaignId: current.id },
        { tx: ctx.tx },
      );
    }
    await ctx.audit({
      action: `campaign.${input.action}`,
      entityType: 'campaign',
      entityId: current.id,
      changes: { status: [current.status, target] },
    });
    return { campaignId: current.id, status: updated.status, version: updated.version };
  },
});

/** Campanhas (sem as arquivadas, a não ser que se peça), com os números principais. */
export const listCampaigns = defineUseCase({
  name: 'campaigns.list',
  access: 'campaign.manage',
  input: listCampaignsInput,
  async run(ctx, input) {
    const campaigns = await ctx.tx.campaign.findMany({
      where: input.status ? { status: input.status } : { status: { not: 'ARCHIVED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
      select: {
        id: true,
        name: true,
        status: true,
        channel: true,
        dailyContactLimit: true,
        startsAt: true,
        endsAt: true,
        snapshotAt: true,
        activatedAt: true,
        completedAt: true,
        buildError: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        _count: { select: { sdrs: true, variants: true } },
      },
    });
    const ids = campaigns.map((c) => c.id);
    const totals =
      ids.length === 0
        ? []
        : await ctx.tx.$queryRaw<
            {
              campaignId: string;
              selected: number;
              eligible: number;
              released: number;
              contacted: number;
              replied: number;
            }[]
          >`
            SELECT cl.campaign_id::text AS "campaignId",
              count(*)::int AS selected,
              count(*) FILTER (WHERE cl.eligibility = 'ELIGIBLE')::int AS eligible,
              count(*) FILTER (WHERE cl.status = 'RELEASED')::int AS released,
              count(cl.contacted_at)::int AS contacted,
              count(cl.replied_at)::int AS replied
            FROM campaign_leads cl
            WHERE cl.campaign_id = ANY(${ids}::uuid[])
            GROUP BY 1
          `;
    const byId = new Map(totals.map((t) => [t.campaignId, t]));
    return {
      items: campaigns.map(({ _count, ...c }) => {
        const t = byId.get(c.id);
        return {
          ...c,
          sdrs: _count.sdrs,
          variants: _count.variants,
          selected: t?.selected ?? 0,
          eligible: t?.eligible ?? 0,
          released: t?.released ?? 0,
          contacted: t?.contacted ?? 0,
          replied: t?.replied ?? 0,
        };
      }),
    };
  },
});

/** Situações em que os marcos do funil podem mudar. */
const LIVE_STATUSES: readonly CampaignStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED'];

/**
 * Detalhe da campanha: configuração, retrato, motivos de inelegibilidade,
 * distribuição por SDR (com o liberado hoje), funil (F10-04) e resultado por
 * variante com a comparação A/B (F10-05).
 */
export const getCampaign = defineUseCase({
  name: 'campaigns.get',
  access: 'campaign.manage',
  input: campaignIdInput,
  async run(ctx, input) {
    const campaign = await ctx.tx.campaign.findUnique({
      where: { id: input.campaignId },
      include: {
        owner: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        cadence: { select: { id: true, name: true } },
        sdrs: {
          select: { user: { select: { id: true, name: true, status: true, timezone: true } } },
        },
        variants: {
          orderBy: { label: 'asc' },
          select: {
            id: true,
            label: true,
            approach: { select: { id: true, name: true, hypothesis: true } },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundError('Campanha não encontrada.');
    if (LIVE_STATUSES.includes(campaign.status)) {
      await refreshMilestones(ctx.tx, [campaign.id]);
    }
    const [total] = await funnelCounts(ctx.tx, campaign.id, 'none');
    const totals = total ?? { ...EMPTY_FUNNEL, key: null };
    const bySdrRows = await funnelCounts(ctx.tx, campaign.id, 'sdr');
    const byVariantRows = await funnelCounts(ctx.tx, campaign.id, 'variant');
    const reasonRows = await ctx.tx.campaignLead.findMany({
      where: { campaignId: campaign.id, status: 'SKIPPED' },
      select: { ineligibilityReasons: true },
    });

    // Nomes de quem recebeu leads (inclui quem saiu da lista de SDRs depois).
    const people = new Map(campaign.sdrs.map((s) => [s.user.id, s.user]));
    const missing = bySdrRows
      .map((r) => r.key)
      .filter((key): key is string => key !== null && !people.has(key));
    if (missing.length > 0) {
      const extra = await ctx.tx.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, status: true, timezone: true },
      });
      for (const user of extra) people.set(user.id, user);
    }
    const bySdr = [];
    for (const row of bySdrRows) {
      if (!row.key) continue;
      const person = people.get(row.key);
      const day = localDayBounds(ctx.now, person?.timezone ?? DEFAULT_TIME_ZONE);
      const releasedToday = await ctx.tx.campaignLead.count({
        where: {
          campaignId: campaign.id,
          assignedToId: row.key,
          releasedAt: { gte: day.start, lt: day.end },
        },
      });
      bySdr.push({
        userId: row.key,
        name: person?.name ?? 'Pessoa removida',
        active: person?.status === 'ACTIVE',
        inCampaign: campaign.sdrs.some((s) => s.user.id === row.key),
        eligible: row.eligible,
        pending: row.pending,
        released: row.released,
        releasedToday,
        contacted: row.contacted,
        replied: row.replied,
        interested: row.interested,
        opportunity: row.opportunity,
      });
    }

    const variantRows = new Map(byVariantRows.map((r) => [r.key, r]));
    const variants = campaign.variants.map((variant) => {
      const row = variantRows.get(variant.id) ?? { ...EMPTY_FUNNEL, key: variant.id };
      return {
        id: variant.id,
        label: variant.label,
        approach: variant.approach,
        released: row.released,
        contacted: row.contacted,
        delivered: row.delivered,
        replied: row.replied,
        interested: row.interested,
        opportunity: row.opportunity,
        converted: row.converted,
        optedOut: row.optedOut,
        replyRate: rate(row.replied, row.contacted),
        interestRate: rate(row.interested, row.contacted),
        opportunityRate: rate(row.opportunity, row.contacted),
        optOutRate: rate(row.optedOut, row.contacted),
      };
    });
    const abTest =
      variants.length >= 2
        ? {
            replied: compareVariants(
              variants.map((v) => ({
                id: v.id,
                label: v.label,
                successes: v.replied,
                trials: v.contacted,
              })),
            ),
            interested: compareVariants(
              variants.map((v) => ({
                id: v.id,
                label: v.label,
                successes: v.interested,
                trials: v.contacted,
              })),
            ),
          }
        : null;

    const { sdrs, variants: _variants, ...rest } = campaign;
    return {
      campaign: {
        ...rest,
        selection: storedSelection(campaign.filterDefinition),
        sdrs: sdrs.map((s) => ({ id: s.user.id, name: s.user.name, status: s.user.status })),
      },
      counts: {
        selected: totals.selected,
        eligible: totals.eligible,
        pending: totals.pending,
        released: totals.released,
        skipped: totals.skipped,
      },
      skippedReasons: countReasons(reasonRows.map((r) => ({ reasons: r.ineligibilityReasons }))),
      funnel: buildFunnel(totals),
      bySdr,
      variants,
      abTest,
    };
  },
});

/** Leads da campanha (retrato), com motivos, SDR, variante e marcos. */
export const listCampaignLeads = defineUseCase({
  name: 'campaigns.leads',
  access: 'campaign.manage',
  input: listCampaignLeadsInput,
  async run(ctx, input) {
    const exists = await ctx.tx.campaign.count({ where: { id: input.campaignId } });
    if (exists === 0) throw new NotFoundError('Campanha não encontrada.');
    const where: Prisma.CampaignLeadWhereInput = {
      campaignId: input.campaignId,
      ...(input.eligibility ? { eligibility: input.eligibility } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.reason ? { ineligibilityReasons: { has: input.reason } } : {}),
      ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
      ...(input.variantId ? { variantId: input.variantId } : {}),
    };
    const rows = await ctx.tx.campaignLead.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { leadId: 'asc' }],
      take: input.limit + 1,
      ...(input.cursor
        ? {
            cursor: { campaignId_leadId: { campaignId: input.campaignId, leadId: input.cursor } },
            skip: 1,
          }
        : {}),
      select: {
        leadId: true,
        eligibility: true,
        ineligibilityReasons: true,
        status: true,
        priority: true,
        releasedAt: true,
        contactedAt: true,
        repliedAt: true,
        interestedAt: true,
        opportunityAt: true,
        convertedAt: true,
        optedOutAt: true,
        assignedTo: { select: { id: true, name: true } },
        variant: { select: { id: true, label: true, approach: { select: { name: true } } } },
        lead: {
          select: {
            code: true,
            displayName: true,
            stateUf: true,
            municipality: { select: { name: true } },
            stage: { select: { name: true } },
          },
        },
      },
    });
    const total = await ctx.tx.campaignLead.count({ where });
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items,
      total,
      nextCursor: hasMore ? (items[items.length - 1]?.leadId ?? null) : null,
    };
  },
});

/** Retira da campanha um lead que ainda aguarda liberação (não apaga nada). */
export const removeCampaignLead = defineUseCase({
  name: 'campaigns.removeLead',
  access: 'campaign.manage',
  input: removeCampaignLeadInput,
  async run(ctx, input) {
    const removed = await ctx.tx.campaignLead.updateMany({
      where: { campaignId: input.campaignId, leadId: input.leadId, status: 'PENDING' },
      data: { status: 'REMOVED' },
    });
    if (removed.count === 0) {
      throw new BusinessRuleError('Só dá para retirar um lead que ainda aguarda liberação.');
    }
    await ctx.audit({
      action: 'campaign.lead_removed',
      entityType: 'campaign',
      entityId: input.campaignId,
      metadata: { leadId: input.leadId },
    });
    return { removed: true };
  },
});

/**
 * Campanhas do lead (ficha e fila): o SDR vê de qual campanha o lead veio e a
 * abordagem sorteada para ele, quando há teste A/B.
 */
export const getLeadCampaigns = defineUseCase({
  name: 'campaigns.forLead',
  access: 'lead.read',
  input: leadCampaignsInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.campaignLead.findMany({
      where: {
        leadId: input.leadId,
        status: { in: ['PENDING', 'RELEASED'] },
        campaign: { status: { in: ['READY', 'ACTIVE', 'PAUSED', 'COMPLETED'] } },
      },
      orderBy: { addedAt: 'desc' },
      take: 5,
      select: {
        status: true,
        releasedAt: true,
        campaign: { select: { id: true, name: true, status: true, channel: true } },
        variant: {
          select: {
            label: true,
            approach: { select: { id: true, name: true } },
            campaign: { select: { _count: { select: { variants: true } } } },
          },
        },
      },
    });
    return {
      items: rows.map((row) => ({
        campaign: row.campaign,
        status: row.status,
        releasedAt: row.releasedAt,
        approach: row.variant?.approach ?? null,
        /** Letra da variante só quando há teste (duas abordagens ou mais). */
        variantLabel:
          row.variant && row.variant.campaign._count.variants > 1 ? row.variant.label : null,
      })),
    };
  },
});
