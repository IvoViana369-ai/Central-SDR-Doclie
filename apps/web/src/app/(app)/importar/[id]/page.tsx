import { getImportBatch, listLegalBasisAssessments, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { ImportWizard } from '@/components/import/import-wizard';
import { getContainer } from '@/server/container';
import { loadLeadFormOptions } from '@/server/leads';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Importar' };

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'lead.import')) return <AccessDenied />;
  const batch = await loadLead(() => getImportBatch(deps, user.actor, { batchId: id }, meta));
  if (!batch) notFound();
  const [options, assessments] = await Promise.all([
    loadLeadFormOptions(user, deps, meta),
    listLegalBasisAssessments(deps, user.actor, {}, meta),
  ]);
  const { env } = getContainer();
  return (
    <ImportWizard
      initial={batch}
      options={{
        sources: options.sources,
        tags: options.tags,
        owners: options.owners ?? null,
        assessments: assessments.map((a) => ({ id: a.id, name: a.name, legalBasis: a.legalBasis })),
      }}
      maxFileMb={env.IMPORT_MAX_FILE_MB}
    />
  );
}
