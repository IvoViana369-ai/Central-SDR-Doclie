import { listLeadStageHistory } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Passagens do lead pelas etapas, com a duração de cada uma. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) => ({
  data: await listLeadStageHistory(deps, actor, { leadId: params.id }, meta),
}));
