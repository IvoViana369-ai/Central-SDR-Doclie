import { setDefaultCadence } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  setDefaultCadence(deps, actor, { cadenceId: params.id }, meta),
);
