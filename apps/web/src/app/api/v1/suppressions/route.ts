import { addSuppression, listSuppressions } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Lista Não Contatar (valores mascarados). ?status=ACTIVE|REVOKED|ALL&type=&value=&cursor= */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { status, type, value, cursor, limit } = query();
  return listSuppressions(
    deps,
    actor,
    {
      status: (status || undefined) as never,
      type: (type || undefined) as never,
      value: value || undefined,
      cursor: cursor || undefined,
      limit: limit as never,
    },
    meta,
  );
});

/** Inclusão manual por valor ({ type, value, scope?, reason?, notes? }). */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => addSuppression(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
