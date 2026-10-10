import { createLead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Cadastro manual. Possíveis duplicados voltam como 409 POSSIBLE_DUPLICATE com a lista. */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createLead(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
