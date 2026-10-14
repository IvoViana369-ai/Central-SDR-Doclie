import { acceptOpportunity } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  acceptOpportunity(
    deps,
    actor,
    { ...((await body()) as object), opportunityId: params.id } as never,
    meta,
  ),
);
