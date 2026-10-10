import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import {
  engagementActorOf,
  findOngoingEnrollment,
  pauseLeadEnrollment,
  refreshNextAction,
  STOP_REASON_LABELS,
  stopLeadEnrollment,
} from '../../engagement';
import { auditLead, LEAD_EVENTS, requireEditableLead, requireLeadInScope } from '../../leads';
import { moveLeadToStageKey } from '../../pipeline';
import {
  enrollLeadInput,
  leadCadenceInput,
  pauseCadenceInput,
  skipStepInput,
  stopCadenceInput,
} from '../contracts/schemas';
import { ENROLLMENT_STATUS_LABELS, plannedSchedule } from '../domain/schedule';
import {
  advanceEnrollment,
  cadenceCalendar,
  createStepTask,
  enrollmentInclude,
  scheduleCurrentStep,
} from '../infra/engine';

async function recordCadenceEvent(
  ctx: UseCaseContext,
  leadId: string,
  type: string,
  enrollmentId: string,
  payload: Record<string, unknown>,
) {
  await ctx.tx.leadEvent.create({
    data: {
      leadId,
      type,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      subjectType: 'cadence_enrollment',
      subjectId: enrollmentId,
      payload: toJson(payload),
    },
  });
}

/**
 * Inscreve o lead na cadência (M11): o primeiro passo vira tarefa para o
 * responsável. Uma cadência por vez; lead na Lista Não Contatar, ganho ou
 * perdido não entra.
 */
export const enrollLead = defineUseCase({
  name: 'cadence.enroll',
  access: 'lead.update',
  input: enrollLeadInput,
  run: (ctx, input) => enrollInCadence(ctx, input.leadId, { cadenceId: input.cadenceId }),
});

/**
 * A inscrição em si, com as mesmas regras. A liberação das campanhas (Fase 10)
 * também passa por aqui, informando a campanha da inscrição.
 */
export async function enrollInCadence(
  ctx: UseCaseContext,
  leadId: string,
  options: { cadenceId?: string | null; campaignId?: string | null },
) {
  const lead = await requireEditableLead(ctx, leadId, {
    id: true,
    status: true,
    contactStatus: true,
    stage: { select: { key: true, category: true } },
  });
  if (lead.status !== 'ACTIVE') {
    throw new BusinessRuleError('Só leads ativos entram na cadência.');
  }
  if (lead.contactStatus === 'OPTED_OUT' || lead.contactStatus === 'BLOCKED') {
    throw new BusinessRuleError('O lead está na Lista Não Contatar: não pode entrar na cadência.');
  }
  if (lead.stage?.category === 'WON' || lead.stage?.category === 'LOST') {
    throw new BusinessRuleError('Lead ganho ou perdido não entra na cadência. Reabra antes.');
  }
  const ongoing = await findOngoingEnrollment(ctx.tx, lead.id);
  if (ongoing) {
    throw new ConflictError(
      `O lead já está na cadência "${ongoing.cadence.name}". Encerre-a antes de inscrever de novo.`,
    );
  }
  const cadence = await ctx.tx.cadence.findFirst({
    where: options.cadenceId
      ? { id: options.cadenceId, active: true }
      : { isDefault: true, active: true },
    include: { steps: { orderBy: { position: 'asc' } } },
  });
  if (!cadence) throw new NotFoundError('Cadência não encontrada ou inativa.');
  const firstStep = cadence.steps[0];
  if (!firstStep) throw new BusinessRuleError('A cadência não tem passos.');

  const created = await ctx.tx.cadenceEnrollment.create({
    data: {
      leadId: lead.id,
      cadenceId: cadence.id,
      cadenceVersion: cadence.version,
      status: 'ACTIVE',
      currentStepPosition: firstStep.position,
      enrolledById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      enrolledAt: ctx.now,
      campaignId: options.campaignId ?? null,
    },
  });
  const enrollment = await ctx.tx.cadenceEnrollment.findUniqueOrThrow({
    where: { id: created.id },
    include: enrollmentInclude,
  });
  // Pronto para a abordagem: sai de "Novo", "A qualificar" ou "Qualificado".
  await moveLeadToStageKey(ctx, lead.id, 'AWAITING_OUTREACH', {
    source: 'CADENCE',
    onlyFrom: ['NEW', 'TO_QUALIFY', 'QUALIFIED'],
  });
  const calendar = await cadenceCalendar(ctx, enrollment);
  const plan = plannedSchedule(
    ctx.now,
    cadence.steps.map((s) => ({ position: s.position, dayOffset: s.dayOffset })),
    cadence.noResponseAfterDays,
    calendar,
  );
  const firstDue = plan.steps[0]!.dueAt;
  await ctx.tx.cadenceEnrollment.update({
    where: { id: enrollment.id },
    data: { nextStepDueAt: firstDue },
  });
  await createStepTask(ctx, enrollment, firstStep, firstDue);
  await recordCadenceEvent(ctx, lead.id, LEAD_EVENTS.cadenceEnrolled, enrollment.id, {
    cadence: cadence.name,
    version: cadence.version,
  });
  await auditLead(ctx, lead.id, 'cadence.enroll', {
    subjectId: enrollment.id,
    metadata: { cadence: cadence.name, version: cadence.version },
  });
  return { enrollmentId: enrollment.id, plan };
}

/** Pausa a cadência do lead (com data de retomada opcional). */
export const pauseCadence = defineUseCase({
  name: 'cadence.pause',
  access: 'lead.update',
  input: pauseCadenceInput,
  async run(ctx, input) {
    await requireEditableLead(ctx, input.leadId, { id: true });
    if (input.until && input.until <= ctx.now) {
      throw new BusinessRuleError('A data de retomada precisa ser no futuro.');
    }
    const paused = await pauseLeadEnrollment(
      ctx.tx,
      input.leadId,
      input.until ?? null,
      ctx.now,
      engagementActorOf(ctx.actor),
    );
    if (!paused) throw new BusinessRuleError('O lead não tem cadência ativa.');
    await auditLead(ctx, input.leadId, 'cadence.pause', {
      subjectId: paused.id,
      metadata: { until: input.until?.toISOString() ?? null },
    });
    return { enrollmentId: paused.id, status: 'PAUSED' as const };
  },
});

/** Retoma a cadência pausada: o passo atual vence na próxima abertura da janela. */
export const resumeCadence = defineUseCase({
  name: 'cadence.resume',
  access: 'lead.update',
  input: leadCadenceInput,
  async run(ctx, input) {
    await requireEditableLead(ctx, input.leadId, { id: true });
    return resumeEnrollment(ctx, input.leadId);
  },
});

export async function resumeEnrollment(ctx: UseCaseContext, leadId: string) {
  const ongoing = await findOngoingEnrollment(ctx.tx, leadId);
  if (!ongoing || ongoing.status !== 'PAUSED') {
    throw new BusinessRuleError('O lead não tem cadência pausada.');
  }
  await ctx.tx.cadenceEnrollment.update({
    where: { id: ongoing.id },
    data: { status: 'ACTIVE', pausedUntil: null },
  });
  const enrollment = await ctx.tx.cadenceEnrollment.findUniqueOrThrow({
    where: { id: ongoing.id },
    include: enrollmentInclude,
  });
  await scheduleCurrentStep(ctx, enrollment);
  await recordCadenceEvent(ctx, leadId, LEAD_EVENTS.cadenceResumed, ongoing.id, {
    cadence: ongoing.cadence.name,
  });
  await auditLead(ctx, leadId, 'cadence.resume', { subjectId: ongoing.id });
  return { enrollmentId: ongoing.id, status: 'ACTIVE' as const };
}

/** Encerra a cadência do lead (decisão do SDR). */
export const stopCadence = defineUseCase({
  name: 'cadence.stop',
  access: 'lead.update',
  input: stopCadenceInput,
  async run(ctx, input) {
    await requireEditableLead(ctx, input.leadId, { id: true });
    const stopped = await stopLeadEnrollment(
      ctx.tx,
      input.leadId,
      'MANUAL',
      ctx.now,
      engagementActorOf(ctx.actor),
    );
    if (!stopped) throw new BusinessRuleError('O lead não tem cadência em andamento.');
    await auditLead(ctx, input.leadId, 'cadence.stop', {
      subjectId: stopped.id,
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
    });
    return { enrollmentId: stopped.id, status: 'STOPPED' as const };
  },
});

/** Pular o passo atual (ex.: o lead não tem Instagram): a cadência segue para o próximo. */
export const skipCadenceStep = defineUseCase({
  name: 'cadence.skipStep',
  access: 'lead.update',
  input: skipStepInput,
  async run(ctx, input) {
    const task = await ctx.tx.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, leadId: true, status: true, enrollmentId: true, title: true, type: true },
    });
    if (!task) throw new NotFoundError('Tarefa não encontrada.');
    await requireLeadInScope(ctx, task.leadId, { id: true });
    if (task.status !== 'OPEN' || !task.enrollmentId) {
      throw new BusinessRuleError('Só o passo aberto da cadência pode ser pulado.');
    }
    await ctx.tx.task.update({
      where: { id: task.id },
      data: {
        status: 'SKIPPED',
        outcome: input.reason ?? 'Passo pulado.',
        completedAt: ctx.now,
        completedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    await advanceEnrollment(ctx, task.enrollmentId, { executedAt: ctx.now, executed: false });
    await refreshNextAction(ctx.tx, task.leadId);
    await auditLead(ctx, task.leadId, 'cadence.skip_step', {
      subjectId: task.id,
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
    });
    return { taskId: task.id, status: 'SKIPPED' as const };
  },
});

/** Cadência do lead: a inscrição em andamento (passos e próxima data) e o histórico. */
export const getLeadCadence = defineUseCase({
  name: 'cadence.forLead',
  access: 'lead.read',
  input: leadCadenceInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const enrollments = await ctx.tx.cadenceEnrollment.findMany({
      where: { leadId: input.leadId },
      orderBy: { enrolledAt: 'desc' },
      take: 10,
      include: {
        cadence: { include: { steps: { orderBy: { position: 'asc' } } } },
        enrolledBy: { select: { name: true } },
      },
    });
    return enrollments.map((e) => ({
      id: e.id,
      cadence: { id: e.cadence.id, name: e.cadence.name },
      cadenceVersion: e.cadenceVersion,
      status: e.status,
      statusLabel: ENROLLMENT_STATUS_LABELS[e.status],
      stopReason: e.stopReason,
      stopReasonLabel: e.stopReason ? STOP_REASON_LABELS[e.stopReason] : null,
      currentStepPosition: e.currentStepPosition,
      nextStepDueAt: e.nextStepDueAt,
      pausedUntil: e.pausedUntil,
      enrolledAt: e.enrolledAt,
      enrolledByName: e.enrolledBy?.name ?? null,
      endedAt: e.endedAt,
      steps: e.cadence.steps.map((s) => ({
        position: s.position,
        dayOffset: s.dayOffset,
        channel: s.channel,
        messageType: s.messageType,
        targetStageKey: s.targetStageKey,
        done: e.currentStepPosition === null ? true : s.position < e.currentStepPosition,
      })),
    }));
  },
});
