import { setRowDecision } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Decisão de uma linha da prévia (importar, pular, vincular, completar). */
export const PATCH = apiHandler<{ id: string; rowId: string }>(
  async ({ deps, actor, meta, params, body }) =>
    setRowDecision(
      deps,
      actor,
      { ...((await body()) as object), batchId: params.id, rowId: params.rowId } as never,
      meta,
    ),
);
