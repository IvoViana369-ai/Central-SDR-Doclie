import { getInstagramOverview, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { InstagramSettings } from '@/components/instagram/instagram-settings';
import { PageHeader } from '@/components/page-header';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Instagram' };

/** Instagram pela API (ADMIN): conta conectada, mês, consulta de perfis e automação. */
export default async function InstagramSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (
    !roleHasPermission(actor.role, 'settings.manage') ||
    !roleHasPermission(actor.role, 'integration.manage')
  ) {
    return <AccessDenied />;
  }
  const overview = await getInstagramOverview(deps, actor, {}, meta);
  return (
    <>
      <PageHeader
        title="Instagram"
        description="Mensagens e comentários da conta da Docline pela API oficial da Meta. Só se responde a quem escreveu ou comentou; nada é enviado a quem não procurou a Docline."
      />
      <InstagramSettings overview={overview} />
    </>
  );
}
