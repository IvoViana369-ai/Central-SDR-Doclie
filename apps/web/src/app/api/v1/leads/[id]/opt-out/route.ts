import { registerOptOut } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Opt-out em 1 clique: todos os canais (padrão), um canal ({ scope }) ou um contato ({ contactPointId }). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  registerOptOut(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
