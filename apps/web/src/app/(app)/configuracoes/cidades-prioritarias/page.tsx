import { listPriorityCities, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { PriorityCities } from '@/components/settings/priority-cities';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Cidades prioritárias' };

export default async function PriorityCitiesPage() {
  const { user, deps, meta } = await getPageContext();
  // A lista é de leitura geral; incluir e retirar é do ADMIN (a API confere de novo).
  if (!roleHasPermission(user.actor.role, 'settings.manage')) return <AccessDenied />;
  const cities = await listPriorityCities(deps, user.actor, {}, meta);

  return (
    <>
      <PageHeader
        title="Cidades prioritárias"
        description="Leads dessas cidades ganham os pontos do critério “Em cidade prioritária” do score."
      />
      <PriorityCities cities={cities} />
    </>
  );
}
