import { getIntegrationLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Ficha do lead para o CRM (F12-03): só de leads transferidos ao Comercial ou
 * vinculados a outro sistema; cada leitura fica na auditoria. Chave com
 * `leads:read`.
 */
export const GET = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params }) =>
    getIntegrationLead(deps, actor, { leadId: params.id }, meta),
  { apiKey: 'leads:read' },
);
