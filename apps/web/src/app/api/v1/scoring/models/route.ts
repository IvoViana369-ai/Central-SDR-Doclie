import { createScoringDraft, listScoringModels } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Versões do modelo de score e os critérios disponíveis (ADMIN). */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  listScoringModels(deps, actor, {}, meta),
);

/** Abre um rascunho a partir do modelo ativo (ou devolve o rascunho aberto). */
export const POST = apiHandler(
  async ({ deps, actor, meta }) => createScoringDraft(deps, actor, {}, meta),
  { status: 201 },
);
