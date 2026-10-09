import { listUnmatchedInbound } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mensagens no Instagram de quem não é lead (ou com o @ em mais de um lead). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listUnmatchedInbound(
    deps,
    actor,
    { ...(query() as object), channel: 'INSTAGRAM' } as never,
    meta,
  ),
);
