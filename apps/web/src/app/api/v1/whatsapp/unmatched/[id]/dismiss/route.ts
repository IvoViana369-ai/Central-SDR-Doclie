import { dismissUnmatchedInbound } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Descarta a mensagem (fica até a purga de 90 dias). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  dismissUnmatchedInbound(
    deps,
    actor,
    { ...((await body()) as object), unmatchedId: params.id } as never,
    meta,
  ),
);
