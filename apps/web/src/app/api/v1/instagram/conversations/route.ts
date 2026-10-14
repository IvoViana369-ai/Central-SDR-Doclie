import { listInstagramConversations } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Conversas do Instagram dos leads no escopo (`filter`: attention, open, all). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listInstagramConversations(deps, actor, query() as never, meta),
);
