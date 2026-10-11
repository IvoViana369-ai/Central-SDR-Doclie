import { registerExternalOptOut } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Opt-out recebido em outro sistema Docline (F12-04):
 * { identifiers: [{ type, value }], scope?, reason?, notes? }. Chave com
 * `suppression:write`.
 */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    registerExternalOptOut(deps, actor, (await body()) as never, meta),
  { status: 201, apiKey: 'suppression:write' },
);
