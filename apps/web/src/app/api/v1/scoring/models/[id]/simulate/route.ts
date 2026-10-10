import { simulateScoringModel } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Distribuição por faixa com este modelo × o ativo, antes de ativar. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  simulateScoringModel(deps, actor, { modelId: params.id }, meta),
);
