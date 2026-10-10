import { cancelImportBatch } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Cancela antes da gravação e apaga as linhas temporárias. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  cancelImportBatch(deps, actor, { batchId: params.id }, meta),
);
