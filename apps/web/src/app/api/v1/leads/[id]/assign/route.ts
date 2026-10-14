import { assignLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Atribuir ou redistribuir ({ ownerId, reason }); ownerId nulo devolve ao pool. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  assignLead(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
