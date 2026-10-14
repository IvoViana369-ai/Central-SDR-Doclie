import { listProspectingSearches, searchProspects } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Últimas buscas da Prospecção, com as decisões de cada uma. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { limit } = query();
  return {
    data: await listProspectingSearches(
      deps,
      actor,
      { limit: limit ? Number(limit) : undefined },
      meta,
    ),
  };
});

/** Busca na base aberta do CNPJ (UF, cidades, CNAE, só matriz, nome, quantidade). */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    searchProspects(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
