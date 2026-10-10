import { getLeadScore } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Score, faixa, explicação por critério e histórico de mudanças. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getLeadScore(deps, actor, { leadId: params.id }, meta),
);
