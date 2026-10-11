import { ForbiddenError } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Teste de conexão para quem integra (n8n, CRM): devolve o nome, os escopos e
 * o limite da chave usada. Só com chave de API.
 */
export const GET = apiHandler(
  async ({ actor }) => {
    if (actor.kind !== 'apiKey') throw new ForbiddenError('Use uma chave de API (Bearer).');
    return { ok: true, key: { name: actor.name, scopes: actor.scopes, system: actor.system } };
  },
  { apiKey: 'any' },
);
