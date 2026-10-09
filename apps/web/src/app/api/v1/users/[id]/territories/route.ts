import { getUserTerritories, setUserTerritories } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string };

export const GET = apiHandler<Params>(async ({ deps, actor, meta, params }) => ({
  data: await getUserTerritories(deps, actor, { userId: params.id }, meta),
}));

/** Substitui os territórios ({ territories: [{ stateUf, municipalityCode? }] }). */
export const PUT = apiHandler<Params>(async ({ deps, actor, meta, params, body }) => ({
  data: await setUserTerritories(
    deps,
    actor,
    { ...((await body()) as object), userId: params.id } as never,
    meta,
  ),
}));
