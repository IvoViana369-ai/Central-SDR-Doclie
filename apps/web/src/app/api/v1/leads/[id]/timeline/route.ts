import { listLeadTimeline } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Timeline paginada (?cursor=&limit=&types=a,b). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) => {
  const { cursor, limit, types } = query();
  return listLeadTimeline(
    deps,
    actor,
    {
      leadId: params.id,
      cursor: cursor || undefined,
      limit: limit as never,
      types: types ? types.split(',').filter(Boolean) : undefined,
    },
    meta,
  );
});
