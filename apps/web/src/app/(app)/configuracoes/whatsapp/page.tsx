import {
  getWhatsappOverview,
  listApproaches,
  listWhatsappTemplates,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { WhatsappSettings } from '@/components/whatsapp/whatsapp-settings';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'WhatsApp' };

/** WhatsApp pela API (ADMIN): número na Meta, envios do mês, modelos, preços e automação. */
export default async function WhatsappSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (
    !roleHasPermission(actor.role, 'settings.manage') ||
    !roleHasPermission(actor.role, 'integration.manage')
  ) {
    return <AccessDenied />;
  }
  const [overview, templates, approaches] = await Promise.all([
    getWhatsappOverview(deps, actor, {}, meta),
    listWhatsappTemplates(deps, actor, {}, meta),
    listApproaches(deps, actor, { includeInactive: false }, meta),
  ]);
  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Envio pela Cloud API da Meta para números com opt-in, e resposta livre dentro da janela de 24 h aberta pelo contato. Nada é disparado em massa."
      />
      <WhatsappSettings
        overview={overview}
        templates={templates}
        approaches={approaches.map((a) => ({ id: a.id, name: a.name }))}
      />
    </>
  );
}
