import { generateInsights } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Gera os insights agora ({ scope: 'TEAM' | 'USER', userId }). ADMIN e GESTOR. */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  generateInsights(deps, actor, (await body()) as never, meta),
);
