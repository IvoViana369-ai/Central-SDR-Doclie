import { getStageFunnel } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Leads ativos por etapa do pipeline padrão (?userId= para uma pessoa). */
export const GET = apiHandler(async ({ deps, actor, meta, query }) =>
  getStageFunnel(deps, actor, query(), meta),
);
