import { getLeadWhatsapp } from '@docline/core';
import { apiHandler } from '@/server/api';

/** WhatsApp pela API do lead: números (opt-in e janela), gate, conversa e modelos liberados. */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  getLeadWhatsapp(deps, actor, { leadId: params.id }, meta),
);
