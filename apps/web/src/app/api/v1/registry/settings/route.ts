import { updateRegistrySettings } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Configuração da carga (vale a partir da próxima). */
export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateRegistrySettings(deps, actor, (await body()) as never, meta),
);
