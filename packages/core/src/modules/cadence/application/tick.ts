import { z } from 'zod';
import { systemActor } from '../../../shared/actor';
import { defineUseCase, toJson, type CoreDeps } from '../../../shared/use-case';
import { refreshNextAction } from '../../engagement';
import { LEAD_EVENTS } from '../../leads';
import { moveLeadToStageKey } from '../../pipeline';
import { cadenceStageKeys, enrollmentInclude, scheduleCurrentStep } from '../infra/engine';
import { resumeEnrollment } from './enrollment';

/** Uma inscrição vencida, na própria transação (uma falha não trava as outras). */
const processDueEnrollment = defineUseCase({
  name: 'cadence.tickOne',
  access: 'lead.update',
  input: z.object({ enrollmentId: z.uuid() }),
  async run(ctx, input): Promise<'completed' | 'resumed' | 'repaired' | 'skipped'> {
    const enrollment = await ctx.tx.cadenceEnrollment.findUnique({
      where: { id: input.enrollmentId },
      include: { ...enrollmentInclude, tasks: { where: { status: 'OPEN' }, select: { id: true } } },
    });
    if (!enrollment) return 'skipped';
    const leadId = enrollment.lead.id;

    if (enrollment.status === 'PAUSED') {
      if (!enrollment.pausedUntil || enrollment.pausedUntil > ctx.now) return 'skipped';
      await resumeEnrollment(ctx, leadId);
      return 'resumed';
    }
    if (enrollment.status !== 'ACTIVE') return 'skipped';

    if (enrollment.currentStepPosition === null) {
      if (!enrollment.nextStepDueAt || enrollment.nextStepDueAt > ctx.now) return 'skipped';
      // Último passo feito e o prazo passou sem resposta (SDR-FLOW §4.1).
      await moveLeadToStageKey(ctx, leadId, 'NO_RESPONSE', {
        source: 'CADENCE',
        onlyFrom: cadenceStageKeys(enrollment.cadence.steps),
      });
      await ctx.tx.cadenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'COMPLETED', endedAt: ctx.now, nextStepDueAt: null },
      });
      await ctx.tx.leadEvent.create({
        data: {
          leadId,
          type: LEAD_EVENTS.cadenceCompleted,
          occurredAt: ctx.now,
          actorType: 'AUTOMATION',
          subjectType: 'cadence_enrollment',
          subjectId: enrollment.id,
          payload: toJson({ cadence: enrollment.cadence.name }),
        },
      });
      await refreshNextAction(ctx.tx, leadId);
      return 'completed';
    }

    // Passo atual sem tarefa aberta (não deveria acontecer): recria.
    if (enrollment.tasks.length === 0) {
      await scheduleCurrentStep(ctx, enrollment);
      return 'repaired';
    }
    return 'skipped';
  },
});

/**
 * Job `cadence.tick` (a cada 5 min): conclui as cadências sem resposta no
 * prazo (lead em "Sem resposta"), retoma as pausas vencidas e recria a
 * tarefa de um passo que tenha ficado sem tarefa.
 */
export async function runCadenceTick(deps: CoreDeps) {
  const now = deps.clock.now();
  const due = await deps.db.cadenceEnrollment.findMany({
    where: {
      OR: [
        { status: 'ACTIVE', currentStepPosition: null, nextStepDueAt: { lte: now } },
        { status: 'PAUSED', pausedUntil: { lte: now } },
        {
          status: 'ACTIVE',
          currentStepPosition: { not: null },
          tasks: { none: { status: 'OPEN' } },
        },
      ],
    },
    select: { id: true },
    take: 1_000,
  });
  const summary = { completed: 0, resumed: 0, repaired: 0, skipped: 0, failed: 0 };
  const actor = systemActor('cadence.tick');
  for (const { id } of due) {
    try {
      summary[await processDueEnrollment(deps, actor, { enrollmentId: id })] += 1;
    } catch (error) {
      summary.failed += 1;
      deps.logger.error({ err: error, enrollmentId: id }, 'Falha ao processar a cadência');
    }
  }
  if (due.length > 0) deps.logger.info(summary, 'Cadências processadas');
  return summary;
}
