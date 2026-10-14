import { sendTestWebhook } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Enviar teste": evento webhook.test só para este destino (o worker envia). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params }) =>
    sendTestWebhook(deps, actor, { endpointId: params.id }, meta),
  { status: 202 },
);
