import { roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { CampaignForm, type Selection } from '@/components/campaigns/campaign-form';
import { PageHeader } from '@/components/page-header';
import { loadCampaignFormOptions } from '@/server/campaigns';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Nova campanha' };

/** Filtro trazido da lista de leads (`?selecao=<JSON>`); inválido é ignorado. */
function parseSelection(raw: string | string[] | undefined): Selection | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { filter, q } = value as { filter?: unknown; q?: unknown };
    return {
      ...(filter && typeof filter === 'object' ? { filter } : {}),
      ...(typeof q === 'string' && q.trim() ? { q: q.trim().slice(0, 120) } : {}),
    };
  } catch {
    return null;
  }
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'campaign.manage')) return <AccessDenied />;
  const fromList = parseSelection((await searchParams).selecao);
  const options = await loadCampaignFormOptions(user, deps, meta);
  return (
    <>
      <PageHeader
        title="Nova campanha"
        description="Comece em rascunho: nada é selecionado nem enviado até você montar e ativar."
      />
      <CampaignForm options={options} fromList={fromList} currentUserId={user.actor.id} />
    </>
  );
}
