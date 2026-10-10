import { listSalesOwners } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Quem pode receber transferências (nome e perfil). */
export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listSalesOwners(deps, actor, {}, meta),
}));
