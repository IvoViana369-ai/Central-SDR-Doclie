import { retryInstagramUnmatched } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Procurar de novo": consulta o @ na Meta, se faltar, e casa com os leads. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  retryInstagramUnmatched(deps, actor, { unmatchedId: params.id }, meta),
);
