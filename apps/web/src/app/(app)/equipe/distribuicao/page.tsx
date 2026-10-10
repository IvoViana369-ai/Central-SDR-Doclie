import { getAutoAssignSettings, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { DistributionSettings } from '@/components/team/distribution-settings';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Distribuição automática' };

/**
 * Distribuição automática do pool (F11-05; docs/SDR-FLOW.md §10.2) e a
 * disponibilidade de cada SDR (participa, limite de leads ativos, ausência).
 * ADMIN e GESTOR.
 */
export default async function DistributionPage() {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'lead.assign')) return <AccessDenied />;
  const data = await getAutoAssignSettings(deps, user.actor, {}, meta);
  return (
    <>
      <PageHeader
        title="Distribuição automática"
        description="Entrega os leads sem responsável aos SDRs disponíveis, de hora em hora. Nunca tira um lead de alguém e não mexe em leads reservados por campanha."
      />
      <DistributionSettings data={data} />
    </>
  );
}
