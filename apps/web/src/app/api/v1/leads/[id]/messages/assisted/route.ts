import { prepareAssistedMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Contato assistido: confere o gate e devolve o link do app com o texto. A
 * mensagem fica aguardando confirmação do envio.
 */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    prepareAssistedMessage(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 201 },
);
