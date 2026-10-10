import { getRegistryOverview } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Painel da base aberta do CNPJ (ADMIN): fonte, cargas, totais e configuração. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getRegistryOverview(deps, actor, {}, meta),
);
