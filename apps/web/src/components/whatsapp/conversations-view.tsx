'use client';

import Link from 'next/link';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface ConversationRow {
  id: string;
  lead: {
    id: string;
    code: number;
    displayName: string;
    owner: { id: string; name: string } | null;
  };
  /** WhatsApp: o número; Instagram: o @. */
  number?: string | null;
  handle?: string | null;
  profileName: string | null;
  lastInboundAt: Date_ | null;
  lastOutboundAt: Date_ | null;
  window: { open: boolean; expiresAt: Date_ | null };
  awaitingReply: boolean;
}

export interface UnmatchedRow {
  id: string;
  phoneE164: string | null;
  /** Instagram (Fase 8): o @ de quem escreveu, quando a Meta informa. */
  handle?: string | null;
  profileName: string | null;
  messageKind: string;
  body: string | null;
  receivedAt: Date_;
  candidates: { id: string; displayName: string; code: number }[];
}

export type ConversationsTab = 'attention' | 'open' | 'all' | 'unmatched';
export type ConversationsChannel = 'whatsapp' | 'instagram';

/** O que muda entre os canais (Fase 8: Instagram com a mesma tela). */
const CHANNELS = {
  whatsapp: {
    label: 'WhatsApp',
    query: '',
    api: '/whatsapp/unmatched',
    unmatchedLabel: 'Números sem lead',
    unmatchedDescription:
      'Mensagens de números que não estão em nenhum lead (ou estão em mais de um). Nenhum lead é criado sozinho: vincule a um lead que tenha o número, cadastre o lead e procure de novo, ou descarte. Apagadas em 90 dias.',
    contactColumn: 'Número',
    unknownContact: 'Número não identificado',
    sharedContact: (n: number) => `Número em ${n} leads`,
  },
  instagram: {
    label: 'Instagram',
    query: 'canal=instagram',
    api: '/instagram/unmatched',
    unmatchedLabel: 'Quem não é lead',
    unmatchedDescription:
      'Mensagens no Instagram de quem não está em nenhum lead (ou com o @ em mais de um). Nenhum lead é criado sozinho: vincule a um lead que tenha o @, cadastre o lead (ou o @) e procure de novo, ou descarte. Apagadas em 90 dias.',
    contactColumn: 'Instagram',
    unknownContact: '@ não informado pela Meta',
    sharedContact: (n: number) => `@ em ${n} leads`,
  },
} as const;

function tabHref(channel: ConversationsChannel, extra: string) {
  const query = [CHANNELS[channel].query, extra].filter(Boolean).join('&');
  return query ? `/conversas?${query}` : '/conversas';
}

const TABS: { key: ConversationsTab; label?: string; extra: string }[] = [
  { key: 'attention', label: 'Aguardando resposta', extra: '' },
  { key: 'open', label: 'Janela aberta', extra: 'filtro=janela' },
  { key: 'all', label: 'Todas', extra: 'filtro=todas' },
  { key: 'unmatched', extra: 'aba=sem-lead' },
];

function Unmatched({ rows, channel }: { rows: UnmatchedRow[]; channel: ConversationsChannel }) {
  const config = CHANNELS[channel];
  const { run, notice, busy } = useAction();
  return (
    <div className="space-y-3">
      {/* O aviso fica mesmo quando a última pendência sai da lista. */}
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma mensagem pendente.</p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border p-3 text-sm" data-testid="unmatched">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {channel === 'instagram'
                  ? row.handle
                    ? `@${row.handle}`
                    : config.unknownContact
                  : (row.phoneE164 ?? config.unknownContact)}
              </span>
              {row.profileName ? (
                <span className="text-muted-foreground">({row.profileName})</span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(row.receivedAt)}
              </span>
              {row.candidates.length > 1 ? (
                <Badge variant="warning">{config.sharedContact(row.candidates.length)}</Badge>
              ) : null}
            </p>
            {row.body ? <p className="mt-1 whitespace-pre-line">{row.body}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {row.candidates.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`${config.api}/${row.id}/link`, {
                          method: 'POST',
                          body: { leadId: c.id },
                        }),
                      `Mensagem vinculada a ${c.displayName}.`,
                    )
                  }
                >
                  Vincular a {c.displayName}
                </Button>
              ))}
              {row.candidates.length === 0 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/leads/novo">Cadastrar lead</Link>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`${config.api}/${row.id}/retry`, { method: 'POST', body: {} }),
                    'Mensagem vinculada ao lead.',
                  )
                }
              >
                Procurar o lead de novo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`${config.api}/${row.id}/dismiss`, { method: 'POST', body: {} }),
                    'Mensagem descartada.',
                  )
                }
              >
                Descartar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tela Conversas (F7-03; Fase 8): conversas do WhatsApp e do Instagram pela
 * API, das que esperam resposta para as demais, e as mensagens de quem não é
 * lead (ADMIN/GESTOR).
 */
export function ConversationsView({
  channel,
  channels,
  tab,
  conversations,
  unmatched,
}: {
  channel: ConversationsChannel;
  /** Canais com a API ligada (o seletor só aparece com mais de um). */
  channels: ConversationsChannel[];
  tab: ConversationsTab;
  conversations: ConversationRow[];
  /** `null` para quem não decide sobre mensagens de quem não é lead. */
  unmatched: UnmatchedRow[] | null;
}) {
  const config = CHANNELS[channel];
  return (
    <div className="space-y-4">
      {channels.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Canal">
          {channels.map((c) => (
            <Link
              key={c}
              href={tabHref(c, '')}
              aria-current={c === channel ? 'page' : undefined}
              className={cn(
                'rounded-md border px-3 py-1 text-sm',
                c === channel ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted',
              )}
            >
              {CHANNELS[c].label}
            </Link>
          ))}
        </nav>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label="Filtros">
        {TABS.filter((t) => t.key !== 'unmatched' || unmatched !== null).map((t) => (
          <Link
            key={t.key}
            href={tabHref(channel, t.extra)}
            aria-current={t.key === tab ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              t.key === tab ? 'border-primary bg-accent font-medium' : 'hover:bg-muted',
            )}
          >
            {t.label ?? config.unmatchedLabel}
            {t.key === 'unmatched' && unmatched && unmatched.length > 0
              ? ` (${unmatched.length})`
              : ''}
          </Link>
        ))}
      </nav>
      {tab === 'unmatched' && unmatched ? (
        <Card>
          <CardHeader>
            <CardTitle>{config.unmatchedLabel}</CardTitle>
            <CardDescription>{config.unmatchedDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Unmatched rows={unmatched} channel={channel} />
          </CardContent>
        </Card>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conversa neste filtro.</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Lead</Th>
              <Th>{config.contactColumn}</Th>
              <Th>Última mensagem do contato</Th>
              <Th>Janela de atendimento</Th>
              <Th>Responsável</Th>
            </Tr>
          </THead>
          <TBody>
            {conversations.map((c) => (
              <Tr key={c.id} data-testid="conversation">
                <Td>
                  <Link href={`/leads/${c.lead.id}`} className="font-medium hover:underline">
                    {c.lead.displayName}
                  </Link>
                  {c.awaitingReply ? (
                    <Badge variant="warning" className="ml-2">
                      Aguardando resposta
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  {channel === 'instagram' ? (c.handle ? `@${c.handle}` : '—') : (c.number ?? '—')}
                  {c.profileName ? (
                    <span className="block text-xs text-muted-foreground">{c.profileName}</span>
                  ) : null}
                </Td>
                <Td>{formatDateTime(c.lastInboundAt)}</Td>
                <Td>
                  {c.window.open ? `Aberta até ${formatDateTime(c.window.expiresAt)}` : 'Fechada'}
                </Td>
                <Td>{c.lead.owner?.name ?? 'Sem responsável'}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
