import { approveProspects } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Aprova resultados (até 100): cada um vira lead ou completa o lead que já existe. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  approveProspects(deps, actor, { ...((await body()) as object), searchId: params.id }, meta),
);
