import { deleteView, updateView } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string };

export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  updateView(deps, actor, { ...((await body()) as object), viewId: params.id } as never, meta),
);

export const DELETE = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  deleteView(deps, actor, { viewId: params.id }, meta),
);
