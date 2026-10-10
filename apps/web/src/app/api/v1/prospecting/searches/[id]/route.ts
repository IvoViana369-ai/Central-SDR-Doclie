import { getProspectingSearch } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Busca com os resultados, os dados da base aberta e a comparação com a base. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getProspectingSearch(deps, actor, { searchId: params.id }, meta),
);
