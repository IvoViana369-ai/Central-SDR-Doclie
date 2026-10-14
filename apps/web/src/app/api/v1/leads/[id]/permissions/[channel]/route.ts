import { setChannelPermission } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Base legal e opt-in de um canal (ALL = todos). */
export const PUT = apiHandler<{ id: string; channel: string }>(
  async ({ deps, actor, meta, params, body }) =>
    setChannelPermission(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id, channel: params.channel } as never,
      meta,
    ),
);
