import { discardGeneration } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Descartar o rascunho com o motivo (alimenta a avaliação de qualidade). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  discardGeneration(
    deps,
    actor,
    { ...((await body()) as object), generationId: params.id } as never,
    meta,
  ),
);
