import { listKnowledgeItems, upsertKnowledgeItem } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Base de conhecimento da IA (?all=1 inclui os inativos). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listKnowledgeItems(deps, actor, { includeInactive: query().all === '1' }, meta),
}));

/** Criar ou alterar um fato pela chave (ADMIN); mudar o conteúdo sobe a versão. */
export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  upsertKnowledgeItem(deps, actor, (await body()) as never, meta),
);
