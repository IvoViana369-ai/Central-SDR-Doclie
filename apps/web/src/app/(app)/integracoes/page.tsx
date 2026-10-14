import { assertAccess } from '@docline/core';
import { integrationStatuses, type IntegrationStatus } from '@docline/integrations';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { getContainer } from '@/server/container';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Integrações' };

const STATE: Record<
  IntegrationStatus['state'],
  { label: string; variant: 'success' | 'default' | 'warning' | 'muted' | 'destructive' }
> = {
  active: { label: 'Ativa', variant: 'success' },
  assisted: { label: 'Modo assistido', variant: 'default' },
  simulated: { label: 'Simulada', variant: 'warning' },
  disabled: { label: 'Desligada', variant: 'muted' },
  not_implemented: { label: 'Não implementada', variant: 'destructive' },
};

export default async function IntegrationsPage() {
  const { user, deps, meta } = await getPageContext();
  const allowed = await loadIfAllowed(() =>
    assertAccess(deps, user.actor, 'integration.manage', 'integrations', meta),
  );
  if (!allowed.ok) return <AccessDenied />;
  const statuses = integrationStatuses(getContainer().env);

  return (
    <>
      <PageHeader
        title="Integrações"
        description="Provedores configurados neste ambiente. Credenciais nunca são exibidas."
      />
      <Alert className="mb-4" title="Somente APIs oficiais">
        WhatsApp e Instagram funcionam em modo assistido até as Fases 7 e 8: o sistema prepara a
        mensagem e uma pessoa envia pelo aplicativo. Nenhuma automação não oficial é usada.
      </Alert>
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Integração</Th>
              <Th>Provedor</Th>
              <Th>Situação</Th>
              <Th className="hidden sm:table-cell">Integração real</Th>
            </Tr>
          </THead>
          <TBody>
            {statuses.map((status) => (
              <Tr key={status.key}>
                <Td className="font-medium">{status.label}</Td>
                <Td>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{status.provider}</code>
                </Td>
                <Td>
                  <Badge variant={STATE[status.state].variant}>{STATE[status.state].label}</Badge>
                </Td>
                <Td className="hidden text-muted-foreground sm:table-cell">Fase {status.phase}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
