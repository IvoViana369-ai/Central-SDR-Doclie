import { updatePipelineStages } from '@docline/core';
import { apiHandler } from '@/server/api';
import { pipelineIdFrom } from '../pipeline-id';

/** Configura as etapas (ADMIN): a lista completa, na ordem do quadro. */
export const PUT = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updatePipelineStages(
    deps,
    actor,
    { ...((await body()) as object), pipelineId: pipelineIdFrom(params.id) } as never,
    meta,
  ),
);
