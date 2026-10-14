import { archiveLead } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  archiveLead(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
