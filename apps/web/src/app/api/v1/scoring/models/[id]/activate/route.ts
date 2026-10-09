import { activateScoringModel } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Ativa o rascunho; a base é recalculada no worker. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  activateScoringModel(deps, actor, { modelId: params.id }, meta),
);
