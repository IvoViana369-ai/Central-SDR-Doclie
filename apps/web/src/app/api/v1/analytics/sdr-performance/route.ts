import { getSdrPerformance } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Desempenho por SDR no período (?from=&to=): carteira, atividade e coorte. ADMIN e GESTOR. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getSdrPerformance(deps, actor, query() as never, meta),
);
