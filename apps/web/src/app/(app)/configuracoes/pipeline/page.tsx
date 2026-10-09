import { getPipeline, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { StagesEditor } from '@/components/settings/stages-editor';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Etapas do pipeline' };

export default async function PipelineSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  // A leitura do pipeline é de todos; editar é do ADMIN (o PUT confere de novo).
  if (!roleHasPermission(user.actor.role, 'settings.manage')) return <AccessDenied />;
  const pipeline = await getPipeline(deps, user.actor, {}, meta);

  return (
    <>
      <PageHeader
        title="Etapas do pipeline"
        description="Nome, cor, ordem e SLA de cada etapa. Nenhuma etapa é excluída: desative as que não usa (sem leads)."
      />
      <StagesEditor initial={pipeline.stages} />
    </>
  );
}
