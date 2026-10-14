import { rescheduleTask } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Reagendar: `dueAt` e `reason`. */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  rescheduleTask(deps, actor, { ...((await body()) as object), taskId: params.id } as never, meta),
);
