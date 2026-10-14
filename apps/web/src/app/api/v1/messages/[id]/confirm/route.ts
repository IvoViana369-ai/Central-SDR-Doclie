import { confirmAssistedMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

/** "Confirmar envio" (`sentAt` opcional): registra e avança etapa, tarefa e cadência. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  confirmAssistedMessage(
    deps,
    actor,
    { ...((await body()) as object), messageId: params.id } as never,
    meta,
  ),
);
