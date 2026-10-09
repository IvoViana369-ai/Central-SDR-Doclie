import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, toJson } from '../../../shared/use-case';
import { auditLead, LEAD_EVENTS, requireEditableLead } from '../../leads';
import { logActivityInput } from '../contracts/schemas';
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_TYPE_LABELS, CONTACT_OUTCOMES } from '../domain/queue';
import { registerOutboundContact } from '../infra/contact';
import { closeTask } from '../infra/tasks';

/**
 * Registrar ligação, reunião ou visita (F5-02). Ligação atendida ou reunião
 * realizada conta como contato feito; com `taskId`, conclui a tarefa.
 */
export const logActivity = defineUseCase({
  name: 'tasks.logActivity',
  access: 'lead.update',
  input: logActivityInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const occurredAt = input.occurredAt ?? ctx.now;
    if (occurredAt > ctx.now) {
      throw new BusinessRuleError(
        'Registre só o que já aconteceu (para o futuro, crie uma tarefa).',
      );
    }
    if (input.contactPointId) {
      const cp = await ctx.tx.contactPoint.findFirst({
        where: { id: input.contactPointId, leadId: lead.id },
        select: { id: true },
      });
      if (!cp) throw new NotFoundError('Contato não encontrado neste lead.');
    }
    const task = input.taskId
      ? await ctx.tx.task.findFirst({
          where: { id: input.taskId, leadId: lead.id, status: 'OPEN' },
          select: { id: true, leadId: true, type: true, title: true },
        })
      : null;
    if (input.taskId && !task) throw new NotFoundError('Tarefa aberta não encontrada neste lead.');

    const activity = await ctx.tx.activity.create({
      data: {
        leadId: lead.id,
        userId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        type: input.type,
        outcome: input.outcome ?? null,
        notes: input.notes,
        occurredAt,
        durationSeconds: input.durationMinutes ? input.durationMinutes * 60 : null,
        taskId: task?.id ?? null,
        contactPointId: input.contactPointId ?? null,
      },
    });
    await ctx.tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: LEAD_EVENTS.activityLogged,
        occurredAt,
        actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
        actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        subjectType: 'activity',
        subjectId: activity.id,
        channel: input.type === 'CALL' ? 'PHONE' : null,
        payload: toJson({ type: input.type, outcome: input.outcome ?? null }),
      },
    });

    const contactMade =
      input.outcome !== null &&
      input.outcome !== undefined &&
      (CONTACT_OUTCOMES as readonly string[]).includes(input.outcome);
    if (contactMade) await registerOutboundContact(ctx, lead.id, occurredAt);
    if (task) {
      const outcome = [
        ACTIVITY_TYPE_LABELS[input.type],
        input.outcome ? ACTIVITY_OUTCOME_LABELS[input.outcome] : null,
      ]
        .filter(Boolean)
        .join(': ');
      await closeTask(ctx, task, 'DONE', outcome);
    }
    await auditLead(ctx, lead.id, 'activity.log', {
      subjectId: activity.id,
      metadata: { type: input.type, outcome: input.outcome ?? null, taskId: task?.id ?? null },
    });
    return { activityId: activity.id, contactMade };
  },
});
