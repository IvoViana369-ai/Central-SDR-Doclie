import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { requireLeadInScope } from '../../leads';
import { taskCalendarInput } from '../contracts/schemas';
import { buildIcs, googleCalendarLink, meetingEvent } from '../domain/calendar';

/**
 * Reunião na agenda (F12-05): o .ics e o link de modelo do Google Agenda de
 * uma tarefa de reunião do lead no escopo. Sem OAuth: a pessoa confirma o
 * evento na própria agenda; o sistema não lê nem grava calendários.
 */
export const getTaskCalendar = defineUseCase({
  name: 'integrations.taskCalendar',
  access: 'lead.read',
  input: taskCalendarInput,
  async run(ctx, input) {
    const task = await ctx.tx.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, type: true, title: true, description: true, dueAt: true, leadId: true },
    });
    if (!task) throw new NotFoundError('Tarefa não encontrada.');
    const lead = await requireLeadInScope(ctx, task.leadId, { id: true, displayName: true });
    if (task.type !== 'MEETING') {
      throw new BusinessRuleError('Só tarefas de reunião vão para a agenda.');
    }
    const event = meetingEvent({
      taskId: task.id,
      title: task.title,
      description: task.description,
      dueAt: task.dueAt,
      lead,
      appUrl: ctx.deps.appUrl,
    });
    return {
      filename: `reuniao-${task.id}.ics`,
      ics: buildIcs(event, ctx.now),
      googleUrl: googleCalendarLink(event),
    };
  },
});
