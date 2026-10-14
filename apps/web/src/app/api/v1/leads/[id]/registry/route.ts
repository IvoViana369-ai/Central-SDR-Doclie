import { enrichLeadFromRegistry, getLeadRegistryData } from '@docline/core';
import { apiHandler } from '@/server/api';

/** O CNPJ do lead na base aberta e o que daria para completar. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getLeadRegistryData(deps, actor, { leadId: params.id }, meta),
);

/** Completa o lead com a base aberta (só campos vazios e contatos novos). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  enrichLeadFromRegistry(deps, actor, { leadId: params.id }, meta),
);
