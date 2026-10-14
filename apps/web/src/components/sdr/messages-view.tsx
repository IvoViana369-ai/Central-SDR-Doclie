'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { MessageItem } from './message-item';
import { MESSAGE_VIEWS, type MessageViewKey } from './message-views';
import type { MessageView } from './shared';

type Row = MessageView & { lead: { id: string; codeLabel: string; displayName: string } };

/**
 * Mensagens (Fase 5): envios a confirmar, respostas para classificar e o
 * histórico, no escopo de leads de quem acessa.
 */
export function MessagesView({
  view,
  initial,
  canEdit,
}: {
  view: MessageViewKey;
  initial: { data: Row[]; nextCursor: string | null };
  canEdit: boolean;
}) {
  const { run, notice, busy } = useAction();
  // Páginas extras carregadas aqui; a primeira vem do servidor (e se renova a cada ação).
  const [more, setMore] = useState<{ data: Row[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rows = [...initial.data, ...(more?.data ?? [])];
  const nextCursor = more ? more.nextCursor : initial.nextCursor;
  const current = MESSAGE_VIEWS.find((v) => v.key === view)!;

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<{ data: Row[]; nextCursor: string | null }>(
        `/messages?view=${view}&cursor=${nextCursor}`,
      );
      setMore((prev) => ({
        data: [...(prev?.data ?? []), ...page.data],
        nextCursor: page.nextCursor,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar mais.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mensagens"
        description="Contato assistido: você envia pelo app e confirma aqui. Respostas com pedido de opt-out vão direto para a Lista Não Contatar."
      />
      <nav aria-label="Visões de mensagens" className="flex flex-wrap gap-2">
        {MESSAGE_VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === 'pending' ? '/mensagens' : `/mensagens?view=${v.key}`}
            aria-current={v.key === view ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              v.key === view ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent',
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{current.empty}</p>
          ) : (
            <ul className="space-y-3" aria-label={current.label}>
              {rows.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  lead={m.lead}
                  canEdit={canEdit}
                  busy={busy}
                  run={async (action, success) => {
                    const result = await run(action, success);
                    // A ação muda a lista (sai de "a confirmar", ganha classificação):
                    // volta à primeira página, que o servidor recarrega.
                    if (result !== null) setMore(null);
                    return result;
                  }}
                />
              ))}
            </ul>
          )}
          {error ? (
            <Alert variant="error" className="mt-3">
              {error}
            </Alert>
          ) : null}
          {nextCursor ? (
            <Button variant="outline" className="mt-3" disabled={loading} onClick={loadMore}>
              Carregar mais
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
