import { listLeadSources } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Origens ativas, com a base legal sugerida para o cadastro. */
export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listLeadSources(deps, actor, {}, meta),
}));
