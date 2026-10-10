import { pullLeadsFromPool } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Puxar os próximos leads do pool do território (`count`, até 20). */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  pullLeadsFromPool(deps, actor, (await body()) as never, meta),
);
