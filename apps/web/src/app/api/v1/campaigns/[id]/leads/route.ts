import { listCampaignLeads } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Leads do retrato, com filtros por aptidão, situação, motivo, SDR e variante. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, query }) => {
  const q = query();
  return listCampaignLeads(
    deps,
    actor,
    {
      campaignId: params.id,
      eligibility: (q.eligibility || undefined) as never,
      status: (q.status || undefined) as never,
      reason: (q.reason || undefined) as never,
      assignedToId: q.assignedToId || undefined,
      variantId: q.variantId || undefined,
      cursor: q.cursor || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    },
    meta,
  );
});
