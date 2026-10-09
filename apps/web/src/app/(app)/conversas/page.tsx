import {
  listConversations,
  listInstagramConversations,
  listUnmatchedInbound,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import {
  ConversationsView,
  type ConversationsChannel,
  type ConversationsTab,
} from '@/components/whatsapp/conversations-view';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Conversas' };

const FILTERS: Record<string, 'attention' | 'open' | 'all'> = {
  janela: 'open',
  todas: 'all',
};

/**
 * Conversas pela API: WhatsApp (F7-03) e Instagram (Fase 8), um canal por vez
 * (`?canal=instagram`). No modo assistido, explica onde ficam as respostas.
 */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  if (!roleHasPermission(actor.role, 'lead.read')) return <AccessDenied />;
  const params = await searchParams;
  const channels: ConversationsChannel[] = [
    ...(deps.whatsapp ? (['whatsapp'] as const) : []),
    ...(deps.instagram ? (['instagram'] as const) : []),
  ];
  const header = (
    <PageHeader
      title="Conversas"
      description="WhatsApp e Instagram pela API: quem respondeu, a janela de 24 h para responder e as mensagens de quem não é lead."
    />
  );
  if (channels.length === 0) {
    return (
      <>
        {header}
        <Alert title="WhatsApp e Instagram pela API desligados">
          O sistema está no modo assistido: as mensagens saem pelos apps (link wa.me, perfil do
          Instagram) e as respostas são registradas pelo SDR em Mensagens. Ligar a API depende da
          conta da Meta aprovada (docs/INTEGRATIONS.md §16).
        </Alert>
      </>
    );
  }

  const channel: ConversationsChannel =
    params.canal === 'instagram' && deps.instagram ? 'instagram' : channels[0]!;
  const canDecide = roleHasPermission(actor.role, 'lead.assign');
  const filter =
    typeof params.filtro === 'string' ? (FILTERS[params.filtro] ?? 'attention') : 'attention';
  const tab: ConversationsTab = params.aba === 'sem-lead' && canDecide ? 'unmatched' : filter;
  const list = channel === 'instagram' ? listInstagramConversations : listConversations;
  const [conversations, unmatched] = await Promise.all([
    tab === 'unmatched' ? Promise.resolve([]) : list(deps, actor, { filter }, meta),
    canDecide
      ? listUnmatchedInbound(
          deps,
          actor,
          { channel: channel === 'instagram' ? 'INSTAGRAM' : 'WHATSAPP' },
          meta,
        )
      : Promise.resolve(null),
  ]);

  return (
    <>
      {header}
      <ConversationsView
        channel={channel}
        channels={channels}
        tab={tab}
        conversations={conversations}
        unmatched={unmatched}
      />
    </>
  );
}
