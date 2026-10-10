import { commitImport } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Confirma a prévia; a gravação roda no worker (`import.commit`). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params }) => commitImport(deps, actor, { batchId: params.id }, meta),
  { status: 202 },
);
