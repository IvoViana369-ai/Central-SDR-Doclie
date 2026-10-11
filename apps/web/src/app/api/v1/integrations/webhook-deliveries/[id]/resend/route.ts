import { resendWebhookDelivery } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Reenvia uma entrega encerrada (nova entrega do mesmo evento). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params }) =>
    resendWebhookDelivery(deps, actor, { deliveryId: params.id }, meta),
  { status: 202 },
);
