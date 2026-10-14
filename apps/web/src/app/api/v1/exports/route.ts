import { exportLeads } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Exportação de leads em CSV (ADMIN/GESTOR, auditada, 5 por dia). O arquivo é
 * gerado na hora e não fica guardado no servidor.
 */
export const POST = apiHandler(async ({ deps, actor, meta, body }) => {
  const result = await exportLeads(deps, actor, (await body()) as never, meta);
  return new Response(result.content, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'cache-control': 'no-store',
      'x-export-count': String(result.count),
      'x-export-omitted-contacts': String(result.omittedContacts),
      'x-request-id': meta.requestId ?? '',
    },
  });
});
