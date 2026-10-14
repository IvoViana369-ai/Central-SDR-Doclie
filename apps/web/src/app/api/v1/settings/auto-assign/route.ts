import { getAutoAssignSettings, updateAutoAssignSettings } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Distribuição automática: configuração, última execução e disponibilidade da equipe. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getAutoAssignSettings(deps, actor, {}, meta),
);

/** Liga, desliga ou ajusta (ADMIN e GESTOR), com auditoria do antes e depois. */
export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateAutoAssignSettings(deps, actor, (await body()) as never, meta),
);
