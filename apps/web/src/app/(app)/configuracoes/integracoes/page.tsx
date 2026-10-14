import {
  listApiKeys,
  listWebhookDeliveries,
  listWebhookEndpoints,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { IntegrationsSettings } from '@/components/integrations/integrations-settings';
import { PageHeader } from '@/components/page-header';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Integrações Docline' };

/** Chaves de API, webhooks de saída e entregas (ADMIN; docs/INTEGRATIONS.md §11). */
export default async function IntegrationsPage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (!roleHasPermission(actor.role, 'integration.manage')) return <AccessDenied />;
  const [keys, endpoints, deliveries] = await Promise.all([
    listApiKeys(deps, actor, {}, meta),
    listWebhookEndpoints(deps, actor, {}, meta),
    listWebhookDeliveries(deps, actor, { limit: 30 }, meta),
  ]);
  return (
    <>
      <PageHeader
        title="Integrações Docline"
        description="CRM, n8n e BI: chaves de API com escopos e avisos assinados por webhook. Nenhuma integração envia mensagem a lead."
      />
      <IntegrationsSettings
        keys={keys.data}
        endpoints={endpoints.data}
        webhooksEnabled={endpoints.enabled}
        deliveries={deliveries.data}
      />
    </>
  );
}
