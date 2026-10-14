import { handoffToSales } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Transferir ao Comercial: `salesOwnerId`, checklist `qualification`, `notes`. */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    handoffToSales(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 201 },
);
