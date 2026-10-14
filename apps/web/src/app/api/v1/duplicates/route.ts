import { listDuplicates } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Fila de possíveis duplicados (filtros: `status`, `confidence`, `rule`; cursor). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listDuplicates(deps, actor, query() as never, meta),
);
