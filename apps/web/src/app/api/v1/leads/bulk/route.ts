import { bulkLeads } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Ação em massa: simule (dryRun) e confirme com o token devolvido. */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  bulkLeads(deps, actor, (await body()) as never, meta),
);
