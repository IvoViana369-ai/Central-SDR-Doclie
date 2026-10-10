import { listStates } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listStates(deps, actor, {}, meta),
}));
