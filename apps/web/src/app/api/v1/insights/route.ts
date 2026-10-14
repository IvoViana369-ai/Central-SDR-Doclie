import { getInsights } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Insights vigentes: da equipe (gestão, ou ?userId=) ou da própria carteira. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getInsights(deps, actor, query() as never, meta),
);
