import { listLeadHistory } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Histórico de alterações de campos (auditoria filtrada pelo lead). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) => {
  const { cursor, limit } = query();
  return listLeadHistory(
    deps,
    actor,
    { leadId: params.id, cursor: cursor || undefined, limit: limit as never },
    meta,
  );
});
