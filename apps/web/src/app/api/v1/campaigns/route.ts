import { createCampaign, listCampaigns } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Campanhas (sem as arquivadas, a não ser com `?status=ARCHIVED`), com os números principais. */
export const GET = apiHandler(async ({ deps, actor, meta, query }) => {
  const { status, limit } = query();
  return listCampaigns(
    deps,
    actor,
    { status: (status || undefined) as never, limit: limit ? Number(limit) : undefined },
    meta,
  );
});

/** Nova campanha em rascunho. Nada é selecionado nem enviado até montar e ativar. */
export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => createCampaign(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
