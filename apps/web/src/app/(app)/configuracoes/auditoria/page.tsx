import { listAuditLogs } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { AuditLogTable } from '@/components/audit/audit-log-table';
import { PageHeader } from '@/components/page-header';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Auditoria' };

export default async function AuditPage() {
  const { user, deps, meta } = await getPageContext();
  const result = await loadIfAllowed(() => listAuditLogs(deps, user.actor, { limit: 50 }, meta));
  if (!result.ok) return <AccessDenied />;

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro imutável de acessos e alterações. Nenhum registro pode ser editado ou apagado pela aplicação."
      />
      <AuditLogTable initial={result.data} />
    </>
  );
}
