import { getPipelineBoard } from '@docline/core';
import { apiHandler } from '@/server/api';
import { pipelineIdFrom } from '../pipeline-id';

/**
 * Quadro: colunas com contagem e os primeiros cards. POST porque recebe a
 * mesma seleção da lista de leads (DSL de filtros e busca) no corpo.
 */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  getPipelineBoard(
    deps,
    actor,
    { ...((await body()) as object), pipelineId: pipelineIdFrom(params.id) } as never,
    meta,
  ),
);
