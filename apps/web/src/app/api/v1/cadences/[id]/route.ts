import { updateCadence } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Regras e passos (ADMIN); sobe a versão. */
export const PUT = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateCadence(
    deps,
    actor,
    { ...((await body()) as object), cadenceId: params.id } as never,
    meta,
  ),
);
