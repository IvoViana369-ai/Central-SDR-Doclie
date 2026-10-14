import { createTag, listTags } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listTags(deps, actor, { includeInactive: query().includeInactive === 'true' }, meta),
}));

export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createTag(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
