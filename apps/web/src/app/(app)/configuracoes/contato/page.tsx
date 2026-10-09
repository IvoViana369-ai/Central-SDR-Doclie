import { getContactRules, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { ContactRulesForm } from '@/components/settings/contact-rules-form';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Regras de contato' };

export default async function ContactRulesPage() {
  const { user, deps, meta } = await getPageContext();
  // A leitura é aberta (o gate e a fila usam as regras); alterar é do ADMIN.
  if (!roleHasPermission(user.actor.role, 'settings.manage')) return <AccessDenied />;
  const rules = await getContactRules(deps, user.actor, {}, meta);

  return (
    <>
      <PageHeader
        title="Regras de contato"
        description="Horário, limites contra excesso de contato, prazos da fila e palavras de opt-out."
      />
      <ContactRulesForm initial={rules} />
    </>
  );
}
