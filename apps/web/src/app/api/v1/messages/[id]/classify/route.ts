import { classifyReply } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Classificar a resposta (`classification`, `outOfOfficeUntil`). Opt-out não volta atrás. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  classifyReply(
    deps,
    actor,
    { ...((await body()) as object), messageId: params.id } as never,
    meta,
  ),
);
