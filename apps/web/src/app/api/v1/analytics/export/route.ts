import { exportAnalyticsReport } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Exportação CSV de um relatório (?report=overview|funnel|city|source|sdr|daily
 * &from=&to=&userId=). ADMIN e GESTOR; cada download fica na auditoria. São
 * números agregados, gerados na hora e não guardados no servidor.
 */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const result = await exportAnalyticsReport(deps, actor, query() as never, meta);
  return new Response(result.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.filename}"`,
      'cache-control': 'no-store',
      'x-request-id': meta.requestId ?? '',
    },
  });
});
