import { getContactRules, updateContactRules } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Regras de contato vigentes (janela, limites, palavras de opt-out, SLAs). */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getContactRules(deps, actor, {}, meta),
);

/** Altera as regras (ADMIN), com auditoria do antes e depois. */
export const PUT = apiHandler(async ({ deps, actor, meta, body }) =>
  updateContactRules(deps, actor, (await body()) as never, meta),
);
