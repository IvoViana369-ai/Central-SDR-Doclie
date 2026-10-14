import { getLead, updateLead } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string };

export const GET = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  getLead(deps, actor, { leadId: params.id }, meta),
);

/** Edição com lock otimista: envie a `version` lida; edição concorrente → 409. */
export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  updateLead(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
