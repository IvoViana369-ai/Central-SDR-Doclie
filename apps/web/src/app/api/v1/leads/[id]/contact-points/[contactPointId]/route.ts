import { removeContactPoint, updateContactPoint } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string; contactPointId: string };

export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  updateContactPoint(
    deps,
    actor,
    {
      ...((await body()) as object),
      leadId: params.id,
      contactPointId: params.contactPointId,
    } as never,
    meta,
  ),
);

export const DELETE = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  removeContactPoint(
    deps,
    actor,
    { leadId: params.id, contactPointId: params.contactPointId },
    meta,
  ),
);
