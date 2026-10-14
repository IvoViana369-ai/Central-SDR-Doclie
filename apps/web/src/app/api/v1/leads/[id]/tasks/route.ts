import { listLeadTasks } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  listLeadTasks(deps, actor, { leadId: params.id }, meta),
);
