import { getConversionReport } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Conversão por recorte, pela coorte do 1º contato no período, com intervalo
 * de confiança (?dimension=city|state|segment|source|owner|firstContactUser|
 * campaign|approach|channel&from=&to=&userId=&limit=). ADMIN e GESTOR.
 */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getConversionReport(deps, actor, query() as never, meta),
);
