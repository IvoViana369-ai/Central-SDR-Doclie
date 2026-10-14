import { createApproach, listApproaches } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Abordagens (hipóteses de mensagem) usadas na IA e nos relatórios (?all=1 inclui inativas). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listApproaches(deps, actor, { includeInactive: query().all === '1' }, meta),
}));

export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createApproach(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
