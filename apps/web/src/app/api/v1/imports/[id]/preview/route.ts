import { getImportPreview } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Prévia paginada, com filtros por situação (`matchStatus`) e por avisos (`withIssues`). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) =>
  getImportPreview(deps, actor, { ...query(), batchId: params.id } as never, meta),
);
