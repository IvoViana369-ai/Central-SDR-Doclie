import { listSegments } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listSegments(deps, actor, {}, meta),
}));
