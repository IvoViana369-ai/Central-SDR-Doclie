import { requestAnalyticsRollup } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Pede o recálculo dos indicadores de um período ({ from, to }), feito pelo worker. */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    requestAnalyticsRollup(deps, actor, (await body()) as never, meta),
  { status: 202 },
);
