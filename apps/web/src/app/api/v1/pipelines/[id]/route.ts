import { getPipeline } from '@docline/core';
import { apiHandler } from '@/server/api';
import { pipelineIdFrom } from './pipeline-id';

/** Pipeline com as etapas (inclusive desativadas) e a contagem de leads ativos. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getPipeline(deps, actor, { pipelineId: pipelineIdFrom(params.id) }, meta),
);
