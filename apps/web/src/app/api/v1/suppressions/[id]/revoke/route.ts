import { revokeSuppression } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Revogação (ADMIN), com motivo ({ reason }). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  revokeSuppression(
    deps,
    actor,
    { ...((await body()) as object), suppressionId: params.id } as never,
    meta,
  ),
);
