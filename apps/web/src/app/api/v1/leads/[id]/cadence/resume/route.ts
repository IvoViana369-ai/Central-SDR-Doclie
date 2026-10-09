import { resumeCadence } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  resumeCadence(deps, actor, { leadId: params.id }, meta),
);
