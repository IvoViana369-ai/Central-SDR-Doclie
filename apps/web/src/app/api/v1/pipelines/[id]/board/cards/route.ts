import { listStageCards } from '@docline/core';
import { apiHandler } from '@/server/api';
import { pipelineIdFrom } from '../../pipeline-id';

/** Próxima página de uma coluna (`stageId`, `cursor` e a mesma seleção do quadro). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  listStageCards(
    deps,
    actor,
    { ...((await body()) as object), pipelineId: pipelineIdFrom(params.id) } as never,
    meta,
  ),
);
