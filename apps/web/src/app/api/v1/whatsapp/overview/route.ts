import { getWhatsappOverview } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Situação do WhatsApp pela API no mês: conexão, envios, entrega, falhas e custo estimado. */
export const GET = apiHandler(async ({ deps, actor, meta }) =>
  getWhatsappOverview(deps, actor, {}, meta),
);
