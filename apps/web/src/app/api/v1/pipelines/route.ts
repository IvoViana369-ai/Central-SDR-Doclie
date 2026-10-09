import { getPipeline } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Pipelines com as etapas e a contagem de leads ativos (por enquanto, só o padrão). */
export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: [await getPipeline(deps, actor, {}, meta)],
}));
