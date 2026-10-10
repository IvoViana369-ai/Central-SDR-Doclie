import { getAnalyticsOverview } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Indicadores do período (?from=&to=AAAA-MM-DD&userId=). Sem `report.read`, só os próprios. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getAnalyticsOverview(deps, actor, query(), meta),
);
