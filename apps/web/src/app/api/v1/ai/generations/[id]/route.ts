import { editGeneration, getGeneration } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getGeneration(deps, actor, { generationId: params.id }, meta),
);

/** Salvar a edição do SDR: os guardrails rodam de novo no texto editado. */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  editGeneration(
    deps,
    actor,
    { ...((await body()) as object), generationId: params.id } as never,
    meta,
  ),
);
