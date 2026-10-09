import { anonymizeLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Anonimização (ADMIN), com motivo; por padrão mantém os identificadores na Lista Não Contatar. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  anonymizeLead(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
