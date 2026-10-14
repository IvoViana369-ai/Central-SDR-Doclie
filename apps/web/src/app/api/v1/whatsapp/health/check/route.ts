import { checkWhatsappHealth } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Consulta agora a qualidade, o limite e a situação do número na Meta (ADMIN). */
export const POST = apiHandler(async ({ deps, actor, meta }) =>
  checkWhatsappHealth(deps, actor, meta),
);
