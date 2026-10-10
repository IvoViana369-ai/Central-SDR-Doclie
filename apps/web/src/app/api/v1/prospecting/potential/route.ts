import { getProspectingPotential } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Potencial por cidade de uma UF (?uf=CE): universo da base aberta × base × contatados. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getProspectingPotential(deps, actor, { uf: query().uf ?? '' }, meta),
);
