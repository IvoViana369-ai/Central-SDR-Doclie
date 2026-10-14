import { listMessages } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mensagens no escopo (?view=pending|sent|replies|unclassified&cursor=). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { view, cursor } = query();
  return listMessages(deps, actor, { view: view as never, cursor: cursor || undefined }, meta);
});
