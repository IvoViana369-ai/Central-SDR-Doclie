import { generateOutreach } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Gerar abordagem com IA (M12): rascunho com avisos, nunca enviado sem a
 * aprovação de uma pessoa. Lead fora do contato (Não Contatar, sem base
 * legal) volta como BLOCKED, sem chamar a IA.
 */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    generateOutreach(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
