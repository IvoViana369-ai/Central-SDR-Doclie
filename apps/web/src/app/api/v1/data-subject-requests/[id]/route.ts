import { updateDataSubjectRequest } from '@docline/core';
import { apiHandler } from '@/server/api';

export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateDataSubjectRequest(
    deps,
    actor,
    { ...((await body()) as object), requestId: params.id } as never,
    meta,
  ),
);
