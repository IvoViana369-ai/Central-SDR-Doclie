import { removePerson, updatePerson } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string; personId: string };

export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  updatePerson(
    deps,
    actor,
    { ...((await body()) as object), leadId: params.id, personId: params.personId } as never,
    meta,
  ),
);

export const DELETE = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  removePerson(deps, actor, { leadId: params.id, personId: params.personId }, meta),
);
