import { listImportBatches } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { ImportHome } from '@/components/import/import-home';
import { getContainer } from '@/server/container';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Importar' };

export default async function ImportPage() {
  const { user, deps, meta } = await getPageContext();
  const result = await loadIfAllowed(() => listImportBatches(deps, user.actor, {}, meta));
  if (!result.ok) return <AccessDenied />;
  const { env } = getContainer();
  return (
    <ImportHome
      batches={result.data}
      limits={{ maxFileMb: env.IMPORT_MAX_FILE_MB, maxRows: env.IMPORT_MAX_ROWS }}
    />
  );
}
