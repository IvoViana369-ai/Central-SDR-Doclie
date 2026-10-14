import { rejectProspects } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Recusa resultados pendentes (com motivo opcional). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  rejectProspects(
    deps,
    actor,
    { ...((await body()) as object), searchId: params.id } as never,
    meta,
  ),
);
