import { getMonthlyEvolution } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Evolução mensal (?fromMonth=AAAA-MM&toMonth=AAAA-MM&userId=; padrão: 12 meses). ADMIN e GESTOR. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getMonthlyEvolution(deps, actor, query() as never, meta),
);
