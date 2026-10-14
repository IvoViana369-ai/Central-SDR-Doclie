import { rateInsight } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Avalia um insight ({ feedback: 'USEFUL' | 'NOT_USEFUL' }). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  rateInsight(deps, actor, { ...((await body()) as object), insightId: params.id } as never, meta),
);
