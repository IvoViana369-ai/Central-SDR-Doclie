import { listLeadGenerations } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Rascunhos recentes da IA para o lead. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) => ({
  data: await listLeadGenerations(deps, actor, { leadId: params.id }, meta),
}));
