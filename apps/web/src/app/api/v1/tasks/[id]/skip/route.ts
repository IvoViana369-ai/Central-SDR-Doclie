import { skipCadenceStep } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Pular o passo da cadência (a cadência segue para o próximo). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  skipCadenceStep(deps, actor, { ...((await body()) as object), taskId: params.id } as never, meta),
);
