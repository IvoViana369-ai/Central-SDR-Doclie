import { recordWhatsappOptIn } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Registra o opt-in do WhatsApp de um número do lead, com a evidência. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  recordWhatsappOptIn(
    deps,
    actor,
    { ...((await body()) as object), leadId: params.id } as never,
    meta,
  ),
);
