import { sendWhatsappMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Envio pela API do WhatsApp: `{ kind: 'text', body | aiGenerationId }` dentro
 * da janela de 24 h, ou `{ kind: 'template', templateId, params }` para número
 * com opt-in. A mensagem entra na fila (202) e o worker envia.
 */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    sendWhatsappMessage(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 202 },
);
