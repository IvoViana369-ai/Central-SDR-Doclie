import { exportPerformanceReport } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Exportação CSV dos relatórios da Fase 11 (?report=conversion|sdrPerformance|
 * monthly|channels e os filtros de cada um). ADMIN e GESTOR; cada download
 * fica na auditoria. Números agregados, gerados na hora.
 */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const result = await exportPerformanceReport(deps, actor, query() as never, meta);
  return new Response(result.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.filename}"`,
      'cache-control': 'no-store',
      'x-request-id': meta.requestId ?? '',
    },
  });
});
