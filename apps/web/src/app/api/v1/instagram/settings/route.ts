import { getInstagramSettings, updateInstagramSettings } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Consulta de perfis (ligada, teto por hora, validade) e sugestão automática de classificação. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getInstagramSettings(deps, actor, {}, meta),
);

export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateInstagramSettings(deps, actor, (await body()) as never, meta),
);
