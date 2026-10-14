import { listMyNotifications } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listMyNotifications(deps, actor, { limit: query().limit as never }, meta),
);
