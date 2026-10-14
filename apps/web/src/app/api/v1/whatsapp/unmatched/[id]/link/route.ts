import { linkUnmatchedInbound } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Vincula a mensagem a um lead que tem o número (`leadId`). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  linkUnmatchedInbound(
    deps,
    actor,
    { ...((await body()) as object), unmatchedId: params.id } as never,
    meta,
  ),
);
