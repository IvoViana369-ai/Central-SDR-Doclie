import { sendInstagramMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Resposta pelo Instagram (`body` ou `aiGenerationId`), só em até 24 h da
 * última mensagem do contato. A mensagem entra na fila (202) e o worker envia.
 */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    sendInstagramMessage(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 202 },
);
