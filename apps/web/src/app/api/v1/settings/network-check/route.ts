import { assertAccess } from '@docline/core';
import { apiHandler } from '@/server/api';
import { getContainer } from '@/server/container';
import { forwardingReport, ipAddressOptions } from '@/server/request-meta';

/**
 * Diagnóstico do primeiro deploy (docs/SECURITY.md §12, ADMIN): o
 * X-Forwarded-For que a hospedagem entrega, o IP que o sistema usa e o valor
 * sugerido para TRUSTED_PROXIES. Só leitura; nada é gravado.
 */
export const GET = apiHandler(async ({ request, deps, actor, meta }) => {
  await assertAccess(deps, actor, 'settings.manage', 'network-check', meta);
  return forwardingReport(request.headers, ipAddressOptions(getContainer().env.TRUSTED_PROXIES));
});
