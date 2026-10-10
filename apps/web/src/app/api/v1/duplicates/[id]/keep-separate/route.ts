import { keepDuplicatesSeparate } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Manter separados: o par não volta a ser sugerido. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  keepDuplicatesSeparate(
    deps,
    actor,
    { ...((await body()) as object), candidateId: params.id } as never,
    meta,
  ),
);
