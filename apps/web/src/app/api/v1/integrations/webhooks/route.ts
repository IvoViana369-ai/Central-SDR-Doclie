import { createWebhookEndpoint, listWebhookEndpoints } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Destinos de webhooks de saída (ADMIN), com a situação das entregas. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  listWebhookEndpoints(deps, actor, {}, meta),
);

/**
 * Cadastra o destino ({ name, url, events, system? }). O segredo de assinatura
 * vem só nesta resposta (`secret`).
 */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    createWebhookEndpoint(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
