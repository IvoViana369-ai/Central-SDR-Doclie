import { acceptInvitation } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Público: o token do convite é a credencial. Limitado pelo tamanho do token e auditado. */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) =>
    acceptInvitation(deps, actor, (await body()) as never, meta),
  { auth: 'public' },
);
