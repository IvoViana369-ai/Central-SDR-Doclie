import { getCampaign, updateCampaign } from '@docline/core';
import { apiHandler } from '@/server/api';

type Params = { id: string };

/** Configuração, retrato, motivos, distribuição por SDR, funil e A/B. */
export const GET = apiHandler<Params>(async ({ deps, actor, meta, params }) =>
  getCampaign(deps, actor, { campaignId: params.id }, meta),
);

/** Edição com lock otimista (`version`); a estrutura só muda antes de ativar. */
export const PATCH = apiHandler<Params>(async ({ deps, actor, meta, params, body }) =>
  updateCampaign(
    deps,
    actor,
    { ...((await body()) as object), campaignId: params.id } as never,
    meta,
  ),
);
