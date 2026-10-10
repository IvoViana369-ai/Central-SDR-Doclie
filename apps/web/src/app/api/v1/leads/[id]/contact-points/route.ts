import { addContactPoint } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Adiciona contato; a resposta traz `duplicates` (o mesmo contato em outros leads). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    addContactPoint(
      deps,
      actor,
      { ...((await body()) as object), leadId: params.id } as never,
      meta,
    ),
  { status: 201 },
);
