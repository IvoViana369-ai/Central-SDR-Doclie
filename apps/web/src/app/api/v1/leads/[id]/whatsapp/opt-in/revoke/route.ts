import { revokeWhatsappOptIn } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Revoga o opt-in do WhatsApp de um número do lead. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  revokeWhatsappOptIn(
    deps,
    actor,
    { ...((await body()) as object), leadId: params.id } as never,
    meta,
  ),
);
