import { linkInstagramUnmatched } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Vincula a mensagem a um lead que tem o @ de quem escreveu (`leadId`). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  linkInstagramUnmatched(
    deps,
    actor,
    { ...((await body()) as object), unmatchedId: params.id } as never,
    meta,
  ),
);
