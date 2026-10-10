import { getMyQueue } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Minha Fila (?userId= para gestor e ADMIN verem a fila de outra pessoa). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getMyQueue(deps, actor, { userId: query().userId || undefined }, meta),
);
