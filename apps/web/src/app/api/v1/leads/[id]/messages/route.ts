import { listLeadMessages } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) => ({
  data: await listLeadMessages(deps, actor, { leadId: params.id }, meta),
}));
