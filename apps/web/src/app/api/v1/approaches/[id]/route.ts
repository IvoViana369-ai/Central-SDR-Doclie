import { updateApproach } from '@docline/core';
import { apiHandler } from '@/server/api';

export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateApproach(
    deps,
    actor,
    { ...((await body()) as object), approachId: params.id } as never,
    meta,
  ),
);
