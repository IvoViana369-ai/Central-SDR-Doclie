import type { MessageType, Prisma, TaskType } from '@docline/db';
import { NotFoundError, BusinessRuleError } from '../../../shared/errors';
import { toJson, type UseCaseContext } from '../../../shared/use-case';
import { refreshNextAction } from '../../engagement';
import { LEAD_EVENTS, requireLeadInScope } from '../../leads';

export const taskSelect = {
  id: true,
  leadId: true,
  type: true,
  title: true,
  description: true,
  dueAt: true,
  status: true,
  outcome: true,
  completedAt: true,
  enrollmentId: true,
  cadenceStepId: true,
  messageType: true,
  channel: true,
  createdAt: true,
  assignee: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

/** Cria uma tarefa (de qualquer origem), com o evento e a próxima ação do lead. */
export async function createTaskRecord(
  ctx: UseCaseContext,
  data: {
    leadId: string;
    type: TaskType;
    title: string;
    description?: string | null;
    dueAt: Date;
    assigneeId: string | null;
    messageType?: MessageType | null;
  },
) {
  const task = await ctx.tx.task.create({
    data: {
      leadId: data.leadId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      dueAt: data.dueAt,
      assigneeId: data.assigneeId,
      messageType: data.messageType ?? null,
      createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    },
    select: taskSelect,
  });
  await ctx.tx.leadEvent.create({
    data: {
      leadId: data.leadId,
      type: LEAD_EVENTS.taskCreated,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      subjectType: 'task',
      subjectId: task.id,
      payload: toJson({ type: data.type, title: data.title, dueAt: data.dueAt.toISOString() }),
    },
  });
  await refreshNextAction(ctx.tx, data.leadId);
  return task;
}

/** Tarefa aberta de um lead no escopo do ator (fora do escopo, "não existe"). */
export async function requireOpenTask(ctx: UseCaseContext, taskId: string) {
  const task = await ctx.tx.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!task) throw new NotFoundError('Tarefa não encontrada.');
  await requireLeadInScope(ctx, task.leadId, { id: true });
  if (task.status !== 'OPEN') throw new BusinessRuleError('Esta tarefa não está mais aberta.');
  return task;
}

/** Fecha a tarefa (concluída ou pulada), com o evento e a próxima ação do lead. */
export async function closeTask(
  ctx: UseCaseContext,
  task: { id: string; leadId: string; type: TaskType; title: string },
  status: 'DONE' | 'SKIPPED',
  outcome: string | null,
) {
  await ctx.tx.task.update({
    where: { id: task.id },
    data: {
      status,
      outcome,
      completedAt: ctx.now,
      completedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    },
  });
  await ctx.tx.leadEvent.create({
    data: {
      leadId: task.leadId,
      type: LEAD_EVENTS.taskCompleted,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      subjectType: 'task',
      subjectId: task.id,
      payload: toJson({ type: task.type, title: task.title, status, outcome }),
    },
  });
  await refreshNextAction(ctx.tx, task.leadId);
}

/** Conclui as tarefas "Responder" abertas do lead (o SDR respondeu ou a conversa acabou). */
export async function closeReplyTasks(ctx: UseCaseContext, leadId: string, outcome: string) {
  const open = await ctx.tx.task.findMany({
    where: { leadId, status: 'OPEN', type: 'REPLY_NEEDED' },
    select: { id: true, leadId: true, type: true, title: true },
  });
  for (const task of open) await closeTask(ctx, task, 'DONE', outcome);
}
