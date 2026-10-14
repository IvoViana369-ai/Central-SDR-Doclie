import { approveGeneration } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Aprovar o texto e preparar o contato assistido (cria a mensagem pendente e
 * devolve o link do app). Guardrail bloqueante impede aprovar sem corrigir.
 */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  approveGeneration(
    deps,
    actor,
    { ...((await body()) as object), generationId: params.id } as never,
    meta,
  ),
);
