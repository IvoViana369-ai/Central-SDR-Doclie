import { listScoringModels, listTags } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { ScoringEditor } from '@/components/settings/scoring-editor';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Lead scoring' };

export default async function ScoringSettingsPage() {
  const { user, deps, meta } = await getPageContext();
  const result = await loadIfAllowed(() =>
    Promise.all([
      listScoringModels(deps, user.actor, {}, meta),
      listTags(deps, user.actor, {}, meta),
    ]),
  );
  if (!result.ok) return <AccessDenied />;
  const [{ models, criteria }, tags] = result.data;

  return (
    <>
      <PageHeader
        title="Lead scoring"
        description="Pesos dos critérios e faixas. Cada mudança vira uma versão nova: simule o impacto e ative quando estiver pronta."
      />
      <ScoringEditor models={models} criteria={criteria} tags={tags} />
    </>
  );
}
