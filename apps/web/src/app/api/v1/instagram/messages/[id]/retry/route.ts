import { retryInstagramMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Tentar de novo" um envio do Instagram que falhou (`confirmDuplicateRisk` para resultado incerto). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    retryInstagramMessage(
      deps,
      actor,
      { ...((await body()) as object), messageId: params.id } as never,
      meta,
    ),
  { status: 202 },
);
