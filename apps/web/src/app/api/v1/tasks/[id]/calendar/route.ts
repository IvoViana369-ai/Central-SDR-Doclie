import { getTaskCalendar } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Reunião na agenda (F12-05): ?format=ics baixa o .ics; ?format=google abre o
 * modelo do Google Agenda para a pessoa confirmar na própria conta.
 */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) => {
  const calendar = await getTaskCalendar(deps, actor, { taskId: params.id }, meta);
  if (query().format === 'google') {
    return new Response(null, {
      status: 302,
      headers: { location: calendar.googleUrl, 'cache-control': 'no-store' },
    });
  }
  return new Response(calendar.ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${calendar.filename}"`,
      'cache-control': 'no-store',
    },
  });
});
