import { addPriorityCity, listPriorityCities } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Cidades prioritárias com a quantidade de leads ativos. */
export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listPriorityCities(deps, actor, {}, meta),
}));

/** Inclui (ou reativa) uma cidade: `municipalityCode` e `notes`. O score é recalculado no worker. */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    addPriorityCity(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
