import { searchMunicipalities } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Autocompletar de município (?q=sob&uf=CE). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { q, uf, limit } = query();
  return {
    data: await searchMunicipalities(
      deps,
      actor,
      { q: q ?? '', uf: uf || undefined, limit: limit as never },
      meta,
    ),
  };
});
