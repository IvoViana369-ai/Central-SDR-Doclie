import { createApiKey, listApiKeys } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Chaves de API (ADMIN). ?status=ACTIVE|ALL. Nunca devolve a chave nem o hash. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { status } = query();
  return listApiKeys(deps, actor, { status: (status || undefined) as never }, meta);
});

/**
 * Cria a chave ({ name, scopes, system?, rateLimitPerMinute?, expiresAt? }).
 * A chave inteira vem só nesta resposta (`key`).
 */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createApiKey(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
