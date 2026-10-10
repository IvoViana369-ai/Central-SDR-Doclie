import { suggestReplyClassification } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Sugestão de classificação de uma resposta recebida ({ messageId }). Não muda
 * nada sozinha: a pessoa confirma pela classificação manual.
 */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  suggestReplyClassification(deps, actor, (await body()) as never, meta),
);
