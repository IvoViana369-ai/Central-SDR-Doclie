import { refreshLeadInstagram } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Consulta agora as métricas públicas dos @ do lead (no máximo uma vez por hora). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  refreshLeadInstagram(deps, actor, { leadId: params.id }, meta),
);
