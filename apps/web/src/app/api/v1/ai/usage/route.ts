import { getAiUsage } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Uso, custo e qualidade da IA no mês (?month=AAAA-MM). ADMIN e GESTOR. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getAiUsage(deps, actor, { month: query().month || undefined }, meta),
);
