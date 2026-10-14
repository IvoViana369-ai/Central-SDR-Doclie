import { createTask } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Follow-up avulso ou tarefa agendada (`leadId`, `title`, `dueAt`, `type`, `assigneeId`). */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createTask(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
