import { listUnmatchedInbound } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mensagens de números sem lead (ou em mais de um lead), para decidir. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listUnmatchedInbound(deps, actor, query() as never, meta),
);
