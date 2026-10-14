import { getRegistryOverview, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { RegistryAdmin } from '@/components/prospecting/registry-admin';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Dados abertos do CNPJ' };

/** Base aberta do CNPJ (ADMIN): fonte, cargas mensais e configuração (F9-01). */
export default async function RegistrySettingsPage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (!roleHasPermission(actor.role, 'integration.manage')) return <AccessDenied />;
  const overview = await getRegistryOverview(deps, actor, {}, meta);
  return (
    <>
      <PageHeader
        title="Dados abertos do CNPJ"
        description="Cópia local dos escritórios de contabilidade ativos da base aberta da Receita Federal, usada na Prospecção e para completar leads pelo CNPJ. Só arquivos oficiais, sem consulta a sites de pesquisa."
      />
      <RegistryAdmin overview={overview} />
    </>
  );
}
