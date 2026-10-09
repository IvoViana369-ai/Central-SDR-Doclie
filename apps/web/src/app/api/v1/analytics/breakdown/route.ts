import { getAnalyticsBreakdown } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Quebra por dimensão (?dimension=city|source|sdr&from=&to=&userId=&limit=). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getAnalyticsBreakdown(deps, actor, query() as never, meta),
);
