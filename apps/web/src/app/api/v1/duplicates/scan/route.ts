import { requestDuplicateScan } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Dispara a varredura completa no worker (ADMIN e GESTOR). */
export const POST = apiHandler(
  async ({ deps, actor, meta }) => requestDuplicateScan(deps, actor, {}, meta),
  { status: 202 },
);
