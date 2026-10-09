import { listConversations, listUnmatchedInbound, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { ConversationsView, type ConversationsTab } from '@/components/whatsapp/conversations-view';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Conversas' };

const FILTERS: Record<string, 'attention' | 'open' | 'all'> = {
  janela: 'open',
  todas: 'all',
};

/** Conversas do WhatsApp pela API (F7-03). No modo assistido, explica onde ficam as respostas. */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (!roleHasPermission(actor.role, 'lead.read')) return <AccessDenied />;
  const params = await searchParams;
  const header = (
    <PageHeader
      title="Conversas"
      description="WhatsApp pela API: quem respondeu, a janela de 24 h para responder com texto livre e os números sem lead."
    />
  );
  if (!deps.whatsapp) {
    return (
      <>
        {header}
        <Alert title="WhatsApp pela API desligado">
          O sistema está no modo assistido: as mensagens saem pelo app do WhatsApp (link wa.me) e as
          respostas são registradas pelo SDR em Mensagens. Ligar a API depende da conta da Meta
          aprovada (docs/INTEGRATIONS.md §16).
        </Alert>
      </>
    );
  }

  const canDecide = roleHasPermission(actor.role, 'lead.assign');
  const filter =
    typeof params.filtro === 'string' ? (FILTERS[params.filtro] ?? 'attention') : 'attention';
  const tab: ConversationsTab = params.aba === 'sem-lead' && canDecide ? 'unmatched' : filter;
  const [conversations, unmatched] = await Promise.all([
    tab === 'unmatched' ? Promise.resolve([]) : listConversations(deps, actor, { filter }, meta),
    canDecide ? listUnmatchedInbound(deps, actor, {}, meta) : Promise.resolve(null),
  ]);

  return (
    <>
      {header}
      <ConversationsView tab={tab} conversations={conversations} unmatched={unmatched} />
    </>
  );
}
