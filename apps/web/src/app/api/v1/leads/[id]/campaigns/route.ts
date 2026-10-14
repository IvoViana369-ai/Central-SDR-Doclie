import { getLeadCampaigns } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Campanhas do lead e a abordagem sorteada (no escopo do lead). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getLeadCampaigns(deps, actor, { leadId: params.id }, meta),
);
