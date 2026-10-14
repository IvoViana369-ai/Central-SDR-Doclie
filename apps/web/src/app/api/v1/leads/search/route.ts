import { searchLeads } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Lista com filtros (DSL no corpo), busca, ordenação e cursor. */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  searchLeads(deps, actor, (await body()) as never, meta),
);
