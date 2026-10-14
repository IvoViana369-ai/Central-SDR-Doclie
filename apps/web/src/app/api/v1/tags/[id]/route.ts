import { updateTag } from '@docline/core';
import { apiHandler } from '@/server/api';

export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateTag(deps, actor, { ...((await body()) as object), tagId: params.id } as never, meta),
);
