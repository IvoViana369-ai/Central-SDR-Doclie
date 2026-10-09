import { getAiRules, updateAiRules } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Regras dos guardrails da IA (limites, opt-out, termos proibidos). */
export const GET = apiHandler(async ({ deps, actor, meta }) => getAiRules(deps, actor, {}, meta));

export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateAiRules(deps, actor, (await body()) as never, meta),
);
