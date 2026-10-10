import { removePriorityCity } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Tira a cidade da lista (o registro fica, desativado). */
export const DELETE = apiHandler<{ code: string }>(async ({ deps, actor, meta, params }) =>
  removePriorityCity(deps, actor, { municipalityCode: Number(params.code) }, meta),
);
