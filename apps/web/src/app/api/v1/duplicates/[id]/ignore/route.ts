import { ignoreDuplicate } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Ignorar por agora: volta à fila só com um motivo novo. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  ignoreDuplicate(
    deps,
    actor,
    { ...((await body()) as object), candidateId: params.id } as never,
    meta,
  ),
);
