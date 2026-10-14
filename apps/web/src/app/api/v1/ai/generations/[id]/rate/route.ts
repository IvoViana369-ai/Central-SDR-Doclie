import { rateGeneration } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Nota de 1 a 5 para o rascunho, com comentário opcional. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  rateGeneration(
    deps,
    actor,
    { ...((await body()) as object), generationId: params.id } as never,
    meta,
  ),
);
