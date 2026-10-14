import { listLossReasons } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Motivos de perda ativos (?stageKey=LOST_NO_RESPONSE filtra os da etapa). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listLossReasons(deps, actor, { stageKey: query().stageKey || undefined }, meta),
}));
