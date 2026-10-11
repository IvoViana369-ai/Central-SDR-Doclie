import { rotateWebhookSecret } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Novo segredo de assinatura (o anterior deixa de valer); vem só nesta resposta. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  rotateWebhookSecret(deps, actor, { endpointId: params.id }, meta),
);
