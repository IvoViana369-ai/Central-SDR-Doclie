import { getImportBatch } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Status, colunas, primeiras linhas e sugestão de mapeamento. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getImportBatch(deps, actor, { batchId: params.id }, meta),
);
