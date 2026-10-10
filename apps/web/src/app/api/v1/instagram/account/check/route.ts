import { checkInstagramAccount } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Confere agora o token e a conta profissional da Docline na Meta (ADMIN). */
export const POST = apiHandler(async ({ deps, actor, meta }) =>
  checkInstagramAccount(deps, actor, meta),
);
