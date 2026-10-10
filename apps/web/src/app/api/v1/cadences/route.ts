import { createCadence, listCadences } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Cadências ativas (?all=1 inclui as inativas). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listCadences(deps, actor, { includeInactive: query().all === '1' }, meta),
}));

/** Cadência nova (ADMIN). */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createCadence(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
