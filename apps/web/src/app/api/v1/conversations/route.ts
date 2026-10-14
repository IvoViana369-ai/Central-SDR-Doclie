import { listConversations } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Conversas do WhatsApp dos leads no escopo (`filter`: attention, open, all). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  listConversations(deps, actor, query() as never, meta),
);
