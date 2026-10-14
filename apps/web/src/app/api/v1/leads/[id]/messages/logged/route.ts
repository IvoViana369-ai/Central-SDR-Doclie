import { logOutboundMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Registrar um contato feito fora do fluxo (mensagem já enviada). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    logOutboundMessage(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 201 },
);
