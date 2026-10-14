import { retryWhatsappMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Tentar de novo" um envio pela API que falhou (`confirmDuplicateRisk` para resultado incerto). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    retryWhatsappMessage(
      deps,
      actor,
      { ...((await body()) as object), messageId: params.id } as never,
      meta,
    ),
  { status: 202 },
);
