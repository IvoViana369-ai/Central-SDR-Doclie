import { getDuplicate } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Comparação lado a lado, com as escolhas padrão para cada lado. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getDuplicate(deps, actor, { candidateId: params.id }, meta),
);
