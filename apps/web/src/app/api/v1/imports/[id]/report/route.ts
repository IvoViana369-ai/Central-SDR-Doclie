import { getImportReport } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getImportReport(deps, actor, { batchId: params.id }, meta),
);
