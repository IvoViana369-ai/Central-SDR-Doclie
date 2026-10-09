import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { auditLead, requireEditableLead, requireLeadInScope } from '../../leads';
import {
  cancelTaskInput,
  completeTaskInput,
  createTaskInput,
  leadTasksInput,
  rescheduleTaskInput,
} from '../contracts/schemas';
import { TASK_TYPE_LABELS } from '../domain/queue';
import { closeTask, createTaskRecord, requireOpenTask, taskSelect } from '../infra/tasks';
import { refreshNextAction } from '../../engagement';

/** Gestor e ADMIN distribuem tarefas; os demais só criam para si. */
function canAssignOthers(ctx: { actor: { kind: string; role?: string } }) {
  return ctx.actor.kind !== 'user' || ctx.actor.role === 'ADMIN' || ctx.actor.role === 'MANAGER';
}

/** Follow-up avulso ou tarefa agendada (M11: "ligar terça às 10h"). */
export const createTask = defineUseCase({
  name: 'tasks.create',
  access: 'lead.update',
  input: createTaskInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true, ownerId: true });
    const self = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const assigneeId = input.assigneeId ?? self ?? lead.ownerId;
    if (assigneeId !== self && !canAssignOthers(ctx)) {
      throw new ForbiddenError('Só gestor ou administrador criam tarefas para outra pessoa.');
    }
    if (assigneeId) {
      const user = await ctx.tx.user.findUnique({
        where: { id: assigneeId },
        select: { status: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new NotFoundError('Responsável não encontrado.');
    }
    const task = await createTaskRecord(ctx, {
      leadId: lead.id,
      type: input.type,
      title: input.title,
      description: input.description,
      dueAt: input.dueAt,
      assigneeId,
    });
    await auditLead(ctx, lead.id, 'task.create', {
      subjectId: task.id,
      metadata: { type: input.type, dueAt: input.dueAt.toISOString(), assigneeId },
    });
    return task;
  },
});

export const rescheduleTask = defineUseCase({
  name: 'tasks.reschedule',
  access: 'lead.update',
  input: rescheduleTaskInput,
  async run(ctx, input) {
    const task = await requireOpenTask(ctx, input.taskId);
    await ctx.tx.task.update({ where: { id: task.id }, data: { dueAt: input.dueAt } });
    await refreshNextAction(ctx.tx, task.leadId);
    await auditLead(ctx, task.leadId, 'task.reschedule', {
      subjectId: task.id,
      changes: { dueAt: [task.dueAt.toISOString(), input.dueAt.toISOString()] },
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
    });
    return { ...task, dueAt: input.dueAt };
  },
});

/** Concluir com resultado (F5-01). */
export const completeTask = defineUseCase({
  name: 'tasks.complete',
  access: 'lead.update',
  input: completeTaskInput,
  async run(ctx, input) {
    const task = await requireOpenTask(ctx, input.taskId);
    await closeTask(ctx, task, 'DONE', input.outcome);
    await auditLead(ctx, task.leadId, 'task.complete', {
      subjectId: task.id,
      metadata: { type: task.type, ...(input.outcome ? { outcome: input.outcome } : {}) },
    });
    return { taskId: task.id, status: 'DONE' as const };
  },
});

export const cancelTask = defineUseCase({
  name: 'tasks.cancel',
  access: 'lead.update',
  input: cancelTaskInput,
  async run(ctx, input) {
    const task = await requireOpenTask(ctx, input.taskId);
    if (task.enrollmentId) {
      throw new BusinessRuleError(
        'Esta tarefa é um passo da cadência: pule o passo ou encerre a cadência do lead.',
      );
    }
    await ctx.tx.task.update({
      where: { id: task.id },
      data: { status: 'CANCELED', outcome: input.reason },
    });
    await refreshNextAction(ctx.tx, task.leadId);
    await auditLead(ctx, task.leadId, 'task.cancel', {
      subjectId: task.id,
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
    });
    return { taskId: task.id, status: 'CANCELED' as const };
  },
});

/** Tarefas do lead: abertas (por vencimento) e as últimas fechadas. */
export const listLeadTasks = defineUseCase({
  name: 'tasks.listForLead',
  access: 'lead.read',
  input: leadTasksInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const [open, closed] = await Promise.all([
      ctx.tx.task.findMany({
        where: { leadId: input.leadId, status: 'OPEN' },
        orderBy: { dueAt: 'asc' },
        select: taskSelect,
      }),
      ctx.tx.task.findMany({
        where: { leadId: input.leadId, status: { not: 'OPEN' } },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: taskSelect,
      }),
    ]);
    const label = (t: { type: keyof typeof TASK_TYPE_LABELS }) => TASK_TYPE_LABELS[t.type];
    return {
      open: open.map((t) => ({ ...t, typeLabel: label(t), overdue: t.dueAt < ctx.now })),
      closed: closed.map((t) => ({ ...t, typeLabel: label(t), overdue: false })),
    };
  },
});
