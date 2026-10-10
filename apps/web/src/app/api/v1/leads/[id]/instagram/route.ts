import { getLeadInstagram } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Instagram do lead: @ com métricas públicas, janela de 24 h, gate, mensagens e comentários. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getLeadInstagram(deps, actor, { leadId: params.id }, meta),
);
