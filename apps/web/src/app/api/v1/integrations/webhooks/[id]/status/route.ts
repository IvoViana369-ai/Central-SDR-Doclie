import { setWebhookEndpointStatus } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Pausa ou reativa ({ status: 'ACTIVE' | 'PAUSED' }). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  setWebhookEndpointStatus(
    deps,
    actor,
    { ...((await body()) as object), endpointId: params.id } as never,
    meta,
  ),
);
