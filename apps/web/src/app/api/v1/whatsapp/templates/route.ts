import { listWhatsappTemplates } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Modelos da conta na Meta, como sincronizados (ADMIN). */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  listWhatsappTemplates(deps, actor, {}, meta),
);
