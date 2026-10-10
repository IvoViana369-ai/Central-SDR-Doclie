import { configureImport } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mapeamento, política de duplicados, origem e base legal; dispara a prévia no worker. */
export const PUT = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  configureImport(
    deps,
    actor,
    { ...((await body()) as object), batchId: params.id } as never,
    meta,
  ),
);
