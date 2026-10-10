import { getWhatsappSettings, updateWhatsappSettings } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Preços estimados por categoria e sugestão automática de classificação. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getWhatsappSettings(deps, actor, {}, meta),
);

export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateWhatsappSettings(deps, actor, (await body()) as never, meta),
);
