'use client';

import {
  CHANNEL_LABELS,
  REPLY_CLASSIFICATIONS,
  REPLY_CLASSIFICATION_LABELS,
} from '@docline/core/messaging-domain';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { useAction } from '@/components/leads/use-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { type MessageView } from './shared';

/**
 * Uma mensagem (enviada ou recebida) com as ações dela: confirmar ou cancelar
 * o envio pendente e classificar a resposta. Opt-out não se reclassifica:
 * a revogação é pela Conformidade.
 */
export function MessageItem({
  message: m,
  lead,
  canEdit,
  busy,
  run,
}: {
  message: MessageView;
  /** Na tela Mensagens, o lead de cada item. */
  lead?: { id: string; codeLabel: string; displayName: string };
  canEdit: boolean;
  busy: boolean;
  run: ReturnType<typeof useAction>['run'];
}) {
  return (
    <li className="rounded-md border p-2 text-sm" data-testid="message">
      {lead ? (
        <p className="mb-1">
          <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
            {lead.displayName}
          </Link>{' '}
          <span className="text-xs text-muted-foreground">{lead.codeLabel}</span>
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {m.direction === 'INBOUND' ? (
          <ArrowDownLeft className="size-3.5" aria-label="Recebida" />
        ) : (
          <ArrowUpRight className="size-3.5" aria-label="Enviada" />
        )}
        {CHANNEL_LABELS[m.channel] ?? m.channel} · {m.statusLabel}
        {m.messageTypeLabel ? ` · ${m.messageTypeLabel}` : ''} ·{' '}
        {formatDateTime(m.receivedAt ?? m.sentAt ?? m.createdAt)}
        {m.sentBy ? ` · ${m.sentBy.name}` : ''}
      </p>
      {m.body ? <p className="mt-1 whitespace-pre-line">{m.body}</p> : null}
      {m.direction === 'INBOUND' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {m.classificationLabel ? (
            <Badge variant={m.classification === 'OPT_OUT' ? 'destructive' : 'default'}>
              {m.classificationLabel}
              {m.classificationSource === 'RULE' ? ' (regra)' : ''}
            </Badge>
          ) : (
            <Badge variant="warning">Sem classificação</Badge>
          )}
          {canEdit && m.classification !== 'OPT_OUT' ? (
            <Select
              aria-label="Classificar resposta"
              className="h-8 w-auto text-xs"
              value=""
              disabled={busy}
              onChange={(e) =>
                e.target.value &&
                run(
                  () =>
                    api(`/messages/${m.id}/classify`, {
                      method: 'POST',
                      body: { classification: e.target.value },
                    }),
                  'Resposta classificada.',
                )
              }
            >
              <option value="">{m.classification ? 'Reclassificar…' : 'Classificar…'}</option>
              {REPLY_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {REPLY_CLASSIFICATION_LABELS[c]}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : m.status === 'PENDING_CONFIRMATION' && canEdit ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(
                () => api(`/messages/${m.id}/confirm`, { method: 'POST', body: {} }),
                'Envio registrado.',
              )
            }
          >
            Confirmar envio
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(() => api(`/messages/${m.id}/cancel`, { method: 'POST' }), 'Envio cancelado.')
            }
          >
            Não enviei
          </Button>
        </div>
      ) : null}
    </li>
  );
}
