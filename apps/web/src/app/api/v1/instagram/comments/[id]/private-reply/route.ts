import { sendInstagramPrivateReply } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Resposta privada a um comentário do lead (uma por comentário, até 7 dias). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    sendInstagramPrivateReply(
      deps,
      actor,
      { ...((await body()) as object), commentId: params.id } as never,
      meta,
    ),
  { status: 202 },
);
