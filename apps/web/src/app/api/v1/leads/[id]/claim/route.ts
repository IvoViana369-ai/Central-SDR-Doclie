import { claimLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** SDR assume um lead do pool não atribuído do seu território. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  claimLead(deps, actor, { leadId: params.id }, meta),
);
