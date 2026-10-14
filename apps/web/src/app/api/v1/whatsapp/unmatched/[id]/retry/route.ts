import { retryUnmatchedInbound } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Procurar de novo": casa a mensagem como o webhook faria. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  retryUnmatchedInbound(
    deps,
    actor,
    { ...((await body()) as object), unmatchedId: params.id } as never,
    meta,
  ),
);
