import { getLeadContactability } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Gate de contactabilidade por canal (?mode=ASSISTED|API). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) =>
  getLeadContactability(
    deps,
    actor,
    { leadId: params.id, mode: (query().mode || undefined) as never },
    meta,
  ),
);
