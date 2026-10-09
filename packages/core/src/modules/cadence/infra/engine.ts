import type { CadenceStep, Prisma } from '@docline/db';
import type { BusinessCalendar } from '../../../shared/calendar';
import { toJson, type UseCaseContext } from '../../../shared/use-case';
import { PRE_CONTACT_STAGE_KEYS, refreshNextAction } from '../../engagement';
import { LEAD_EVENTS } from '../../leads';
import { moveLeadToStageKey } from '../../pipeline';
import { loadContactRules, loadLeadCalendar } from '../../settings';
import { firstStepDue, nextStepDue, noResponseDue, STEP_TASK_TITLES } from '../domain/schedule';

/**
 * Motor da cadência (docs/SDR-FLOW.md §4): cada passo vira uma tarefa para o
 * SDR (nada é enviado sem ação humana no MVP); a tarefa concluída avança a
 * cadência e o lead de etapa; sem resposta no fim, o lead vai para "Sem
 * resposta". Grava as tarefas direto no banco (o módulo de tarefas chama a
 * cadência, não o contrário).
 */

export const enrollmentInclude = {
  cadence: { include: { steps: { orderBy: { position: 'asc' } } } },
  lead: {
    select: {
      id: true,
      ownerId: true,
      municipalityCode: true,
      stateUf: true,
      status: true,
    },
  },
} satisfies Prisma.CadenceEnrollmentInclude;

export type EnrollmentWithCadence = Prisma.CadenceEnrollmentGetPayload<{
  include: typeof enrollmentInclude;
}>;

/** Calendário do lead com a janela e a contagem de dias da cadência. */
export async function cadenceCalendar(
  ctx: UseCaseContext,
  enrollment: Pick<EnrollmentWithCadence, 'cadence' | 'lead'>,
): Promise<BusinessCalendar> {
  const rules = await loadContactRules(ctx.tx);
  return loadLeadCalendar(ctx.tx, enrollment.lead, ctx.now, {
    rules,
    window: { start: enrollment.cadence.sendWindowStart, end: enrollment.cadence.sendWindowEnd },
    useBusinessDays: enrollment.cadence.useBusinessDays,
  });
}

/** Etapas em que o lead pode estar com a cadência em andamento. */
export function cadenceStageKeys(steps: Pick<CadenceStep, 'targetStageKey'>[]): string[] {
  return [
    ...PRE_CONTACT_STAGE_KEYS,
    ...steps.flatMap((s) => (s.targetStageKey ? [s.targetStageKey] : [])),
  ];
}

/** Cria a tarefa do passo (uma aberta por inscrição, garantida no banco). */
export async function createStepTask(
  ctx: UseCaseContext,
  enrollment: Pick<EnrollmentWithCadence, 'id' | 'enrolledById' | 'cadence' | 'lead'>,
  step: CadenceStep,
  dueAt: Date,
) {
  const assigneeId = enrollment.lead.ownerId ?? enrollment.enrolledById;
  const title = STEP_TASK_TITLES[step.messageType] ?? STEP_TASK_TITLES.OTHER!;
  const task = await ctx.tx.task.create({
    data: {
      leadId: enrollment.lead.id,
      assigneeId,
      type:
        step.messageType === 'FIRST_CONTACT'
          ? 'FIRST_CONTACT'
          : step.action === 'CALL'
            ? 'CALL'
            : 'FOLLOW_UP',
      title: `${title} — ${enrollment.cadence.name}`,
      description: step.instructions,
      dueAt,
      enrollmentId: enrollment.id,
      cadenceStepId: step.id,
      messageType: step.messageType,
      channel: step.channel,
    },
  });
  await ctx.tx.leadEvent.create({
    data: {
      leadId: enrollment.lead.id,
      type: LEAD_EVENTS.taskCreated,
      occurredAt: ctx.now,
      actorType: 'AUTOMATION',
      subjectType: 'task',
      subjectId: task.id,
      payload: toJson({
        type: task.type,
        dueAt: dueAt.toISOString(),
        cadenceStep: step.position,
      }),
    },
  });
  await refreshNextAction(ctx.tx, enrollment.lead.id);
  return task;
}

/** Agenda o passo atual a partir de agora (inscrição, retomada ou reparo). */
export async function scheduleCurrentStep(ctx: UseCaseContext, enrollment: EnrollmentWithCadence) {
  const calendar = await cadenceCalendar(ctx, enrollment);
  const step = enrollment.cadence.steps.find((s) => s.position === enrollment.currentStepPosition);
  if (!step) {
    // Sem passo (a cadência foi encurtada): corre o prazo de "Sem resposta".
    const dueAt = noResponseDue(ctx.now, enrollment.cadence.noResponseAfterDays, calendar);
    await ctx.tx.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: { currentStepPosition: null, nextStepDueAt: dueAt },
    });
    return null;
  }
  const dueAt = firstStepDue(ctx.now, { position: step.position, dayOffset: 0 }, calendar);
  await ctx.tx.cadenceEnrollment.update({
    where: { id: enrollment.id },
    data: { nextStepDueAt: dueAt },
  });
  return createStepTask(ctx, enrollment, step, dueAt);
}

/**
 * O passo atual foi feito (tarefa concluída) ou pulado: move o lead para a
 * etapa do passo (se feito) e agenda o próximo a partir da execução real,
 * ou o prazo de "Sem resposta" depois do último.
 */
export async function advanceEnrollment(
  ctx: UseCaseContext,
  enrollmentId: string,
  options: { executedAt: Date; executed: boolean },
) {
  const enrollment = await ctx.tx.cadenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: enrollmentInclude,
  });
  if (!enrollment || enrollment.status !== 'ACTIVE') return null;
  const steps = enrollment.cadence.steps;
  const current = steps.find((s) => s.position === enrollment.currentStepPosition);
  if (!current) return null;

  if (options.executed && current.targetStageKey) {
    await moveLeadToStageKey(ctx, enrollment.lead.id, current.targetStageKey, {
      source: 'CADENCE',
      onlyFrom: cadenceStageKeys(steps),
    });
  }
  const calendar = await cadenceCalendar(ctx, enrollment);
  const from = options.executedAt > ctx.now ? ctx.now : options.executedAt;
  const next = steps.find((s) => s.position > current.position);
  if (next) {
    const dueAt = nextStepDue(from, current, next, calendar);
    await ctx.tx.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        currentStepPosition: next.position,
        nextStepDueAt: dueAt,
        lastStepExecutedAt: options.executed ? from : enrollment.lastStepExecutedAt,
      },
    });
    await createStepTask(ctx, enrollment, next, dueAt);
  } else {
    await ctx.tx.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        currentStepPosition: null,
        nextStepDueAt: noResponseDue(from, enrollment.cadence.noResponseAfterDays, calendar),
        lastStepExecutedAt: options.executed ? from : enrollment.lastStepExecutedAt,
      },
    });
  }
  return enrollment;
}
