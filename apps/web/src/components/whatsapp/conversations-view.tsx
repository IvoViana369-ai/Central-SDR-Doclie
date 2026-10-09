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
  number: string | null;
  profileName: string | null;
  lastInboundAt: Date_ | null;
  lastOutboundAt: Date_ | null;
  window: { open: boolean; expiresAt: Date_ | null };
  awaitingReply: boolean;
}

export interface UnmatchedRow {
  id: string;
  phoneE164: string | null;
  profileName: string | null;
  messageKind: string;
  body: string | null;
  receivedAt: Date_;
  candidates: { id: string; displayName: string; code: number }[];
}

export type ConversationsTab = 'attention' | 'open' | 'all' | 'unmatched';

const TABS: { key: ConversationsTab; label: string; href: string }[] = [
  { key: 'attention', label: 'Aguardando resposta', href: '/conversas' },
  { key: 'open', label: 'Janela aberta', href: '/conversas?filtro=janela' },
  { key: 'all', label: 'Todas', href: '/conversas?filtro=todas' },
  { key: 'unmatched', label: 'Números sem lead', href: '/conversas?aba=sem-lead' },
];

function Unmatched({ rows }: { rows: UnmatchedRow[] }) {
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
              <span className="font-medium">{row.phoneE164 ?? 'Número não identificado'}</span>
              {row.profileName ? (
                <span className="text-muted-foreground">({row.profileName})</span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(row.receivedAt)}
              </span>
              {row.candidates.length > 1 ? (
                <Badge variant="warning">Número em {row.candidates.length} leads</Badge>
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
                        api(`/whatsapp/unmatched/${row.id}/link`, {
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
                    () => api(`/whatsapp/unmatched/${row.id}/retry`, { method: 'POST', body: {} }),
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
                    () =>
                      api(`/whatsapp/unmatched/${row.id}/dismiss`, { method: 'POST', body: {} }),
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
 * Tela Conversas (F7-03): conversas do WhatsApp pela API, das que esperam
 * resposta para as demais, e as mensagens de números sem lead (ADMIN/GESTOR).
 */
export function ConversationsView({
  tab,
  conversations,
  unmatched,
}: {
  tab: ConversationsTab;
  conversations: ConversationRow[];
  /** `null` para quem não decide sobre números sem lead. */
  unmatched: UnmatchedRow[] | null;
}) {
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Filtros">
        {TABS.filter((t) => t.key !== 'unmatched' || unmatched !== null).map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === tab ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              t.key === tab ? 'border-primary bg-accent font-medium' : 'hover:bg-muted',
            )}
          >
            {t.label}
            {t.key === 'unmatched' && unmatched && unmatched.length > 0
              ? ` (${unmatched.length})`
              : ''}
          </Link>
        ))}
      </nav>
      {tab === 'unmatched' && unmatched ? (
        <Card>
          <CardHeader>
            <CardTitle>Números sem lead</CardTitle>
            <CardDescription>
              Mensagens de números que não estão em nenhum lead (ou estão em mais de um). Nenhum
              lead é criado sozinho: vincule a um lead que tenha o número, cadastre o lead e procure
              de novo, ou descarte. Apagadas em 90 dias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Unmatched rows={unmatched} />
          </CardContent>
        </Card>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conversa neste filtro.</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Lead</Th>
              <Th>Número</Th>
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
                  {c.number ?? '—'}
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
