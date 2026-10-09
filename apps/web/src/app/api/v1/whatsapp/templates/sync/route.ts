import { syncWhatsappTemplates } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Lê os modelos da conta na Meta e atualiza o espelho (ADMIN). */
export const POST = apiHandler(async ({ deps, actor, meta }) =>
  syncWhatsappTemplates(deps, actor, meta),
);
