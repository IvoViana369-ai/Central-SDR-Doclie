import { completeTask } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Concluir com resultado (`outcome`). Passo de cadência avança a cadência. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  completeTask(deps, actor, { ...((await body()) as object), taskId: params.id } as never, meta),
);
