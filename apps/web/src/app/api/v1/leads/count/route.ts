import { countLeads } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Contagem prévia de uma seleção, com quebra contactáveis × bloqueados. */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  countLeads(deps, actor, (await body()) as never, meta),
);
