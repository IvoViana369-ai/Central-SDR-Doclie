import { roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { LeadForm } from '@/components/leads/lead-form';
import { PageHeader } from '@/components/page-header';
import { loadLeadFormOptions } from '@/server/leads';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Novo lead' };

export default async function NewLeadPage() {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'lead.create')) return <AccessDenied />;
  const options = await loadLeadFormOptions(user, deps, meta);
  return (
    <>
      <PageHeader
        title="Novo lead"
        description="Antes de salvar, o sistema confere se o lead já existe (CNPJ, telefone, e-mail, Instagram, site)."
      />
      <LeadForm mode="create" options={options} />
    </>
  );
}
