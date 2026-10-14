import { checkDuplicates } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler(async ({ deps, actor, meta, body }) => ({
  data: await checkDuplicates(deps, actor, (await body()) as never, meta),
}));
