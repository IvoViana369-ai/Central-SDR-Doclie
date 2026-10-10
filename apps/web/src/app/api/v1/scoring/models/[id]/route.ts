import { discardScoringDraft, updateScoringDraft } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Salva o rascunho: nome, normalização, faixas e regras. */
export const PUT = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateScoringDraft(
    deps,
    actor,
    { ...((await body()) as object), modelId: params.id } as never,
    meta,
  ),
);

/** Descarta o rascunho (versões ativas e arquivadas não são apagadas). */
export const DELETE = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  discardScoringDraft(deps, actor, { modelId: params.id }, meta),
);
