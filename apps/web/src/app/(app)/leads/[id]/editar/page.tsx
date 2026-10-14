import { getLead } from '@docline/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadForm } from '@/components/leads/lead-form';
import { PageHeader } from '@/components/page-header';
import { loadLeadFormOptions } from '@/server/leads';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Editar lead' };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  const lead = await loadLead(() => getLead(deps, user.actor, { leadId: id }, meta));
  if (!lead || lead.status === 'MERGED' || lead.status === 'ANONYMIZED') notFound();
  const options = await loadLeadFormOptions(user, deps, meta);
  return (
    <>
      <PageHeader
        title={`Editar ${lead.displayName}`}
        description={`${lead.codeLabel} · contatos e pessoas são editados no detalhe do lead.`}
      />
      <LeadForm mode="edit" options={options} lead={lead} />
    </>
  );
}
