import { addNote } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    addNote(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
  { status: 201 },
);
