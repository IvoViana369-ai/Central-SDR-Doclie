import { checkSuppressions } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Consulta da Lista Não Contatar por outro sistema (F12-04):
 * { identifiers: [{ type, value }], channel? } → bloqueado ou não, sem revelar
 * a lista. POST para o valor não ir na URL (logs). Chave com `suppression:check`.
 */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    checkSuppressions(deps, actor, (await body()) as never, meta),
  { apiKey: 'suppression:check' },
);
