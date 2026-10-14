import { setDecisionsByStatus } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mesma decisão para todas as linhas de uma situação (ex.: pular os possíveis duplicados). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  setDecisionsByStatus(
    deps,
    actor,
    { ...((await body()) as object), batchId: params.id } as never,
    meta,
  ),
);
