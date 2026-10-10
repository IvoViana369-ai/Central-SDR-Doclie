import { listOpportunities } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Oportunidades visíveis ao ator (?status=OPEN|WON|LOST). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listOpportunities(
    deps,
    actor,
    { status: (query().status || undefined) as never },
    meta,
  ),
}));
