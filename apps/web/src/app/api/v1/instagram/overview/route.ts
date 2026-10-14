import { getInstagramOverview } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Situação do Instagram pela API no mês: conta, respostas, leitura, falhas e consulta de perfis. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getInstagramOverview(deps, actor, {}, meta),
);
