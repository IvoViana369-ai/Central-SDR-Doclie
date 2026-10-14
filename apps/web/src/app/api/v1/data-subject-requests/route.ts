import { createDataSubjectRequest, listDataSubjectRequests } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { status, cursor, limit } = query();
  return listDataSubjectRequests(
    deps,
    actor,
    { status: (status || undefined) as never, cursor: cursor || undefined, limit: limit as never },
    meta,
  );
});

export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    createDataSubjectRequest(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
