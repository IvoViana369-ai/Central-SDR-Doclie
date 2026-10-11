import { listWebhookDeliveries } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Registro das entregas. ?endpointId=&status=&cursor=&limit= */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { endpointId, status, cursor, limit } = query();
  return listWebhookDeliveries(
    deps,
    actor,
    {
      endpointId: endpointId || undefined,
      status: (status || undefined) as never,
      cursor: cursor || undefined,
      limit: (limit || undefined) as never,
    },
    meta,
  );
});
