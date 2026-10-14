import { getPipeline, listCadences, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { CadencesEditor } from '@/components/settings/cadences-editor';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Cadências' };

export default async function CadencesSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  // A leitura é aberta (quem inscreve leads vê as ativas); configurar é do ADMIN.
  if (!roleHasPermission(user.actor.role, 'settings.manage')) return <AccessDenied />;
  const [cadences, pipeline] = await Promise.all([
    listCadences(deps, user.actor, { includeInactive: true }, meta),
    getPipeline(deps, user.actor, {}, meta),
  ]);

  return (
    <>
      <PageHeader
        title="Cadências"
        description="Passos de contato do SDR. Cada passo vira uma tarefa na data certa; o lead avança de etapa quando o passo é feito."
      />
      <CadencesEditor
        cadences={cadences}
        stages={pipeline.stages.filter((s) => s.active).map((s) => ({ key: s.key, name: s.name }))}
      />
    </>
  );
}
