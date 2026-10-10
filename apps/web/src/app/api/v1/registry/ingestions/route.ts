import { startRegistryIngestion } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Roda a carga agora (ADMIN): o mês mais recente publicado por completo, ou
 * retoma a carga interrompida. `force` carrega de novo o mês já carregado.
 */
export const POST = apiHandler(async ({ deps, actor, meta, body }) => {
  const input = (await body()) as { force?: unknown } | null;
  return startRegistryIngestion(deps, actor, { force: input?.force === true }, meta);
});
