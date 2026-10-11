import { updateWebhookEndpoint } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Altera nome, URL, eventos ou sistema ({ name?, url?, events?, system? }). */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateWebhookEndpoint(
    deps,
    actor,
    { ...((await body()) as object), endpointId: params.id } as never,
    meta,
  ),
);
