import { campaignAction } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Montar, ativar, pausar, retomar, concluir ou arquivar (`{ action, version }`). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  campaignAction(
    deps,
    actor,
    { ...((await body()) as object), campaignId: params.id } as never,
    meta,
  ),
);
