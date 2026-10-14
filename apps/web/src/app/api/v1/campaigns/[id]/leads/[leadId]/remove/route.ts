import { removeCampaignLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Retira da campanha um lead que ainda aguarda liberação (o lead não é apagado). */
export const POST = apiHandler<{ id: string; leadId: string }>(
  async ({ deps, actor, meta, params }) =>
    removeCampaignLead(deps, actor, { campaignId: params.id, leadId: params.leadId }, meta),
);
