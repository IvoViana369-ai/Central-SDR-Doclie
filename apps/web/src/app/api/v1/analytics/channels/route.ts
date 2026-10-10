import { getChannelReport } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Canais no período (?from=&to=): WhatsApp × Instagram e os demais. ADMIN e GESTOR. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getChannelReport(deps, actor, query() as never, meta),
);
