import { recordReply } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Resposta recebida (texto colado), com detecção de opt-out e classificação opcional. */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    recordReply(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
  { status: 201 },
);
