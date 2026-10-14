import { getActiveScoringModel } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Modelo ativo e as regras. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getActiveScoringModel(deps, actor, {}, meta),
);
