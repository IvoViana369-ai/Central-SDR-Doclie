import { cancelTask } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  cancelTask(deps, actor, { ...((await body()) as object), taskId: params.id } as never, meta),
);
