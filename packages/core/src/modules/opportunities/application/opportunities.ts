import type { Prisma } from '@docline/db';
import { dueAfter } from '../../../shared/calendar';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { engagementActorOf, stopLeadEnrollment } from '../../engagement';
import {
  auditLead,
  formatLeadCode,
  LEAD_EVENTS,
  leadScopeWhere,
  requireEditableLead,
  requireLeadInScope,
} from '../../leads';
import { notify } from '../../notifications';
import { moveLeadToStageKey } from '../../pipeline';
import { loadContactRules, loadLeadCalendar } from '../../settings';
import { closeTask, createTaskRecord } from '../../tasks';
import {
  handoffInput,
  leadOpportunitiesInput,
  listOpportunitiesInput,
  markLostInput,
  markWonInput,
  opportunityIdInput,
} from '../contracts/schemas';
import { CONVERSION_TYPE_LABELS, OPPORTUNITY_STATUS_LABELS } from '../domain/qualification';

/** Perfis que podem receber a transferência (o comercial; gestor e ADMIN cobrem). */
const SALES_ROLES = ['SALES', 'MANAGER', 'ADMIN'] as const;

const opportunitySelect = {
  id: true,
  leadId: true,
  status: true,
  handoffAt: true,
  acceptDueAt: true,
  acceptedAt: true,
  qualification: true,
  productInterest: true,
  expectedValue: true,
  wonAt: true,
  lostAt: true,
  conversionType: true,
  notes: true,
  sdr: { select: { id: true, name: true } },
  salesOwner: { select: { id: true, name: true } },
  lossReason: { select: { key: true, name: true } },
  lead: { select: { id: true, code: true, displayName: true, cityRaw: true, stateUf: true } },
} satisfies Prisma.OpportunitySelect;

type OpportunityRow = Prisma.OpportunityGetPayload<{ select: typeof opportunitySelect }>;

function describeOpportunity(o: OpportunityRow, now: Date) {
  return {
    ...o,
    expectedValue: o.expectedValue ? Number(o.expectedValue) : null,
    lead: { ...o.lead, codeLabel: formatLeadCode(o.lead.code) },
    statusLabel: OPPORTUNITY_STATUS_LABELS[o.status],
    conversionTypeLabel: o.conversionType ? CONVERSION_TYPE_LABELS[o.conversionType] : null,
    /** Aceite atrasado: passou do prazo e o comercial ainda não aceitou. */
    acceptOverdue: o.status === 'OPEN' && !o.acceptedAt && o.acceptDueAt < now,
  };
}

const actorId = (ctx: UseCaseContext) => (ctx.actor.kind === 'user' ? ctx.actor.id : null);

/** Oportunidade aberta (ou não) de um lead no escopo; o comercial dela, gestor e ADMIN decidem. */
async function requireOpportunity(ctx: UseCaseContext, opportunityId: string) {
  const opportunity = await ctx.tx.opportunity.findUnique({
    where: { id: opportunityId },
    select: opportunitySelect,
  });
  if (!opportunity) throw new NotFoundError('Oportunidade não encontrada.');
  await requireLeadInScope(ctx, opportunity.leadId, { id: true });
  return opportunity;
}

function assertCanDecide(ctx: UseCaseContext, opportunity: OpportunityRow) {
  if (ctx.actor.kind !== 'user') return;
  const privileged = ctx.actor.role === 'ADMIN' || ctx.actor.role === 'MANAGER';
  if (!privileged && opportunity.salesOwner?.id !== ctx.actor.id) {
    throw new ForbiddenError(
      'Só o comercial responsável, o gestor ou o ADMIN decidem a oportunidade.',
    );
  }
}

async function recordOpportunityEvent(
  ctx: UseCaseContext,
  leadId: string,
  type: string,
  opportunityId: string,
  payload: Record<string, unknown>,
) {
  await ctx.tx.leadEvent.create({
    data: {
      leadId,
      type,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
      actorId: actorId(ctx),
      subjectType: 'opportunity',
      subjectId: opportunityId,
      payload: toJson(payload),
    },
  });
}

/**
 * Transferir ao Comercial (F5-12; docs/SDR-FLOW.md §8.2): checklist
 * preenchido, oportunidade aberta, lead em "Oportunidade", cadência
 * encerrada, tarefa e aviso ao comercial (prazo de aceite em dias úteis).
 */
export const handoffToSales = defineUseCase({
  name: 'opportunities.handoff',
  access: 'lead.update',
  input: handoffInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, {
      id: true,
      code: true,
      status: true,
      ownerId: true,
      displayName: true,
      contactStatus: true,
      municipalityCode: true,
      stateUf: true,
      stage: { select: { category: true } },
    });
    if (lead.status !== 'ACTIVE')
      throw new BusinessRuleError('Só leads ativos podem ser transferidos.');
    if (lead.stage?.category === 'WON' || lead.stage?.category === 'LOST') {
      throw new BusinessRuleError('Lead ganho ou perdido não pode ser transferido. Reabra antes.');
    }
    if (await ctx.tx.opportunity.count({ where: { leadId: lead.id, status: 'OPEN' } })) {
      throw new ConflictError('Este lead já tem uma oportunidade aberta com o Comercial.');
    }
    const salesOwner = await ctx.tx.user.findUnique({
      where: { id: input.salesOwnerId },
      select: { id: true, name: true, role: true, status: true },
    });
    if (
      !salesOwner ||
      salesOwner.status !== 'ACTIVE' ||
      !(SALES_ROLES as readonly string[]).includes(salesOwner.role)
    ) {
      throw new NotFoundError('Comercial não encontrado ou inativo.');
    }

    const rules = await loadContactRules(ctx.tx);
    const calendar = await loadLeadCalendar(ctx.tx, lead, ctx.now, { rules });
    const acceptDueAt = dueAfter(ctx.now, rules.handoffAcceptBusinessDays, calendar);
    const opportunity = await ctx.tx.opportunity.create({
      data: {
        leadId: lead.id,
        sdrId: lead.ownerId ?? actorId(ctx),
        salesOwnerId: salesOwner.id,
        handoffAt: ctx.now,
        acceptDueAt,
        qualification: toJson(input.qualification),
        productInterest: input.productInterest,
        expectedValue: input.expectedValue ?? null,
        notes: input.notes,
      },
      select: opportunitySelect,
    });
    await stopLeadEnrollment(
      ctx.tx,
      lead.id,
      'STAGE_CHANGED',
      ctx.now,
      engagementActorOf(ctx.actor),
    );
    await moveLeadToStageKey(ctx, lead.id, 'OPPORTUNITY', {
      source: 'HANDOFF',
      unlessClosed: true,
    });
    await createTaskRecord(ctx, {
      leadId: lead.id,
      type: 'HANDOFF_REVIEW',
      title: `Aceitar transferência de ${lead.displayName}`,
      description: input.notes,
      dueAt: acceptDueAt,
      assigneeId: salesOwner.id,
    });
    await notify(ctx.tx, {
      userId: salesOwner.id,
      type: 'handoff.created',
      title: `Nova oportunidade: ${lead.displayName}`,
      body: 'Confira o checklist de qualificação e aceite a transferência no prazo.',
      leadId: lead.id,
    });
    await recordOpportunityEvent(ctx, lead.id, LEAD_EVENTS.handoffCreated, opportunity.id, {
      salesOwnerId: salesOwner.id,
    });
    await auditLead(ctx, lead.id, 'opportunity.handoff', {
      subjectId: opportunity.id,
      metadata: { salesOwnerId: salesOwner.id, acceptDueAt: acceptDueAt.toISOString() },
    });
    return describeOpportunity(opportunity, ctx.now);
  },
});

/** O comercial aceita a transferência (cumpre o SLA); o SDR é avisado. */
export const acceptOpportunity = defineUseCase({
  name: 'opportunities.accept',
  access: 'lead.update',
  input: opportunityIdInput,
  async run(ctx, input) {
    const opportunity = await requireOpportunity(ctx, input.opportunityId);
    assertCanDecide(ctx, opportunity);
    if (opportunity.status !== 'OPEN')
      throw new BusinessRuleError('A oportunidade já foi encerrada.');
    if (opportunity.acceptedAt) return describeOpportunity(opportunity, ctx.now);
    await ctx.tx.opportunity.update({
      where: { id: opportunity.id },
      data: { acceptedAt: ctx.now },
    });
    const review = await ctx.tx.task.findMany({
      where: { leadId: opportunity.leadId, type: 'HANDOFF_REVIEW', status: 'OPEN' },
      select: { id: true, leadId: true, type: true, title: true, enrollmentId: true },
    });
    for (const task of review) await closeTask(ctx, task, 'DONE', 'Transferência aceita.');
    if (opportunity.sdr && opportunity.sdr.id !== actorId(ctx)) {
      await notify(ctx.tx, {
        userId: opportunity.sdr.id,
        type: 'handoff.accepted',
        title: `Transferência aceita: ${opportunity.lead.displayName}`,
        leadId: opportunity.leadId,
      });
    }
    await recordOpportunityEvent(
      ctx,
      opportunity.leadId,
      LEAD_EVENTS.opportunityAccepted,
      opportunity.id,
      {},
    );
    await auditLead(ctx, opportunity.leadId, 'opportunity.accept', { subjectId: opportunity.id });
    return describeOpportunity(
      await ctx.tx.opportunity.findUniqueOrThrow({
        where: { id: opportunity.id },
        select: opportunitySelect,
      }),
      ctx.now,
    );
  },
});

/** Ganha: lead "Convertido" (parceiro ou cliente); a conversão conta também para o SDR. */
export const markOpportunityWon = defineUseCase({
  name: 'opportunities.won',
  access: 'lead.update',
  input: markWonInput,
  async run(ctx, input) {
    const opportunity = await requireOpportunity(ctx, input.opportunityId);
    assertCanDecide(ctx, opportunity);
    if (opportunity.status !== 'OPEN')
      throw new BusinessRuleError('A oportunidade já foi encerrada.');
    await ctx.tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: 'WON',
        wonAt: ctx.now,
        acceptedAt: opportunity.acceptedAt ?? ctx.now,
        conversionType: input.conversionType,
        ...(input.notes ? { notes: input.notes } : {}),
      },
    });
    await closeOpenReview(ctx, opportunity.leadId, 'Oportunidade ganha.');
    await moveLeadToStageKey(ctx, opportunity.leadId, 'CONVERTED', { source: 'HANDOFF' });
    await finishOpportunity(ctx, opportunity, LEAD_EVENTS.opportunityWon, 'opportunity.won', {
      conversionType: input.conversionType,
    });
    return describeOpportunity(
      await ctx.tx.opportunity.findUniqueOrThrow({
        where: { id: opportunity.id },
        select: opportunitySelect,
      }),
      ctx.now,
    );
  },
});

/** Perdida: motivo obrigatório; o lead vai para "Sem interesse" com o motivo. */
export const markOpportunityLost = defineUseCase({
  name: 'opportunities.lost',
  access: 'lead.update',
  input: markLostInput,
  async run(ctx, input) {
    const opportunity = await requireOpportunity(ctx, input.opportunityId);
    assertCanDecide(ctx, opportunity);
    if (opportunity.status !== 'OPEN')
      throw new BusinessRuleError('A oportunidade já foi encerrada.');
    const reason = await ctx.tx.lossReason.findFirst({
      where: { id: input.lossReasonId, active: true },
      select: { key: true },
    });
    if (!reason) throw new NotFoundError('Motivo de perda não encontrado.');
    await ctx.tx.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: 'LOST',
        lostAt: ctx.now,
        lossReasonId: input.lossReasonId,
        ...(input.notes ? { notes: input.notes } : {}),
      },
    });
    await closeOpenReview(ctx, opportunity.leadId, 'Oportunidade perdida.');
    await moveLeadToStageKey(ctx, opportunity.leadId, 'NOT_INTERESTED', {
      source: 'HANDOFF',
      unlessClosed: true,
      lossReasonKey: reason.key,
    });
    await finishOpportunity(ctx, opportunity, LEAD_EVENTS.opportunityLost, 'opportunity.lost', {
      lossReason: reason.key,
    });
    return describeOpportunity(
      await ctx.tx.opportunity.findUniqueOrThrow({
        where: { id: opportunity.id },
        select: opportunitySelect,
      }),
      ctx.now,
    );
  },
});

async function closeOpenReview(ctx: UseCaseContext, leadId: string, outcome: string) {
  const review = await ctx.tx.task.findMany({
    where: { leadId, type: 'HANDOFF_REVIEW', status: 'OPEN' },
    select: { id: true, leadId: true, type: true, title: true, enrollmentId: true },
  });
  for (const task of review) await closeTask(ctx, task, 'DONE', outcome);
}

async function finishOpportunity(
  ctx: UseCaseContext,
  opportunity: OpportunityRow,
  eventType: string,
  auditAction: string,
  payload: Record<string, unknown>,
) {
  await recordOpportunityEvent(ctx, opportunity.leadId, eventType, opportunity.id, payload);
  if (opportunity.sdr && opportunity.sdr.id !== actorId(ctx)) {
    await notify(ctx.tx, {
      userId: opportunity.sdr.id,
      type: eventType,
      title: `${eventType === LEAD_EVENTS.opportunityWon ? 'Ganha' : 'Perdida'}: ${opportunity.lead.displayName}`,
      leadId: opportunity.leadId,
    });
  }
  await auditLead(ctx, opportunity.leadId, auditAction, {
    subjectId: opportunity.id,
    metadata: payload,
  });
}

/** Oportunidades visíveis ao ator (comercial: as suas; SDR: as que transferiu; gestão: todas). */
export const listOpportunities = defineUseCase({
  name: 'opportunities.list',
  access: 'lead.read',
  input: listOpportunitiesInput,
  async run(ctx, input) {
    const scope = await leadScopeWhere(ctx.tx, ctx.actor);
    const mine: Prisma.OpportunityWhereInput =
      ctx.actor.kind === 'user' && ctx.actor.role === 'SALES'
        ? { salesOwnerId: ctx.actor.id }
        : ctx.actor.kind === 'user' && ctx.actor.role === 'SDR'
          ? { sdrId: ctx.actor.id }
          : {};
    const rows = await ctx.tx.opportunity.findMany({
      where: { ...mine, ...(input.status ? { status: input.status } : {}), lead: scope },
      orderBy: [{ status: 'asc' }, { handoffAt: 'desc' }],
      take: 200,
      select: opportunitySelect,
    });
    return rows.map((o) => describeOpportunity(o, ctx.now));
  },
});

/** Oportunidades do lead (ficha). */
export const listLeadOpportunities = defineUseCase({
  name: 'opportunities.forLead',
  access: 'lead.read',
  input: leadOpportunitiesInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.opportunity.findMany({
      where: { leadId: input.leadId },
      orderBy: { handoffAt: 'desc' },
      select: opportunitySelect,
    });
    return rows.map((o) => describeOpportunity(o, ctx.now));
  },
});
