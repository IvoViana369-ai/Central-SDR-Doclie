import { getDailySeries } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Evolução diária do período (dias locais do fuso da operação). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getDailySeries(deps, actor, query(), meta),
);
