'use client';

import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface InstagramProfileView {
  contactPointId: string;
  handle: string;
  profileUrl: string;
  metrics: {
    status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
    followersCount: number | null;
    mediaCount: number | null;
    lastPostAt: Date_ | null;
    daysSinceLastPost: number | null;
    checkedAt: Date_;
  } | null;
  window: { open: boolean; expiresAt: Date_ | null };
  lastInboundAt: Date_ | null;
  profileName: string | null;
  usable: boolean;
}

export interface InstagramMessageView {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  mode: 'API' | 'ASSISTED' | string;
  status: string;
  statusLabel: string;
  body: string | null;
  createdAt: Date_;
  sentAt: Date_ | null;
  readAt: Date_ | null;
  receivedAt: Date_ | null;
  errorDetail: string | null;
  sentBy: { name: string } | null;
  privateReply: boolean;
  retry: 'none' | 'allowed' | 'wait' | 'confirm';
}

export interface InstagramCommentView {
  id: string;
  authorHandle: string;
  mediaProductType: string | null;
  isReply: boolean;
  body: string | null;
  commentedAt: Date_;
  privateReply: {
    state: 'available' | 'sent' | 'expired';
    deadline: Date_;
    status: string | null;
    statusLabel: string | null;
    body: string | null;
    sentAt: Date_ | null;
  };
}

export interface LeadInstagramView {
  provider: string | null;
  leadActive: boolean;
  discoveryEnabled: boolean;
  gate: { allowed: boolean; reasons: string[] } | null;
  profiles: InstagramProfileView[];
  messages: InstagramMessageView[];
  comments: InstagramCommentView[];
}

/** A Meta aceita até 1.000 bytes por mensagem (acentos ocupam mais de um). */
const MAX_BYTES = 1000;
const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const newRequestId = () => crypto.randomUUID();
const numberFormat = new Intl.NumberFormat('pt-BR');

type Run = ReturnType<typeof useAction>['run'];

function StatusIcon({ status }: { status: string }) {
  if (status === 'READ') return <CheckCheck className="size-3.5 text-primary" aria-hidden />;
  if (status === 'SENT') return <Check className="size-3.5" aria-hidden />;
  if (status === 'FAILED')
    return <AlertTriangle className="size-3.5 text-destructive" aria-hidden />;
  return <Clock className="size-3.5" aria-hidden />;
}

function Metrics({ profile }: { profile: InstagramProfileView }) {
  const m = profile.metrics;
  if (!m) return <span className="text-xs text-muted-foreground">Ainda não consultado.</span>;
  if (m.status === 'NOT_FOUND') {
    return (
      <span className="text-xs text-muted-foreground">
        Não é conta profissional (sem métricas públicas) · consultado em {formatDate(m.checkedAt)}
      </span>
    );
  }
  const days = m.daysSinceLastPost;
  return (
    <span className="text-xs text-muted-foreground" data-testid="instagram-metrics">
      {m.followersCount !== null ? `${numberFormat.format(m.followersCount)} seguidores · ` : ''}
      {m.mediaCount !== null ? `${numberFormat.format(m.mediaCount)} publicações · ` : ''}
      {days === null ? 'sem publicações' : `última publicação há ${days} dias`} · consultado em{' '}
      {formatDate(m.checkedAt)}
      {m.status === 'ERROR' ? ' (a última consulta falhou)' : ''}
    </span>
  );
}

/** Reenvio de resultado incerto: a pessoa assume o risco de duplicar. */
function ConfirmRetry({ messageId, run }: { messageId: string; run: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RotateCcw /> Reenviar mesmo assim
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Reenviar?"
        description="Não dá para saber se a mensagem saiu. Se tiver saído, o contato recebe duas vezes."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Não reenviar
          </Button>
          <Button
            onClick={async () => {
              await run(
                () =>
                  api(`/instagram/messages/${messageId}/retry`, {
                    method: 'POST',
                    body: { confirmDuplicateRisk: true },
                  }),
                'Mensagem de volta à fila.',
              );
              setOpen(false);
            }}
          >
            Reenviar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thread({
  messages,
  canEdit,
  busy,
  run,
}: {
  messages: InstagramMessageView[];
  canEdit: boolean;
  busy: boolean;
  run: Run;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma mensagem pelo Instagram ainda.</p>;
  }
  return (
    <ol className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Conversa pelo Instagram">
      {messages.map((m) => {
        const inbound = m.direction === 'INBOUND';
        return (
          <li
            key={m.id}
            data-testid="instagram-message"
            className={cn(
              'max-w-[85%] rounded-lg border p-2 text-sm',
              inbound ? 'mr-auto bg-card' : 'ml-auto bg-accent/40',
            )}
          >
            {m.privateReply ? (
              <p className="text-xs text-muted-foreground">Resposta privada a um comentário</p>
            ) : null}
            {m.body ? <p className="whitespace-pre-line">{m.body}</p> : null}
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {inbound ? null : <StatusIcon status={m.status} />}
              {inbound ? 'Recebida' : m.statusLabel} ·{' '}
              {formatDateTime(m.receivedAt ?? m.readAt ?? m.sentAt ?? m.createdAt)}
              {!inbound && m.mode !== 'API' ? ' · pelo app' : ''}
              {m.sentBy && !inbound ? ` · ${m.sentBy.name}` : ''}
            </p>
            {m.status === 'FAILED' ? (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-destructive">{m.errorDetail}</p>
                {canEdit && m.retry === 'allowed' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api(`/instagram/messages/${m.id}/retry`, { method: 'POST', body: {} }),
                        'Mensagem de volta à fila.',
                      )
                    }
                  >
                    <RotateCcw /> Tentar de novo
                  </Button>
                ) : null}
                {canEdit && m.retry === 'confirm' ? (
                  <ConfirmRetry messageId={m.id} run={run} />
                ) : null}
                {m.retry === 'wait' ? (
                  <p className="text-xs text-muted-foreground">
                    Se a mensagem saiu, a Meta avisa em instantes e o status é corrigido.
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function TextBox({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const bytes = bytesOf(value);
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={`${bytes} de ${MAX_BYTES} bytes${bytes > MAX_BYTES ? ': encurte a mensagem' : ''}`}
    >
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Resposta privada a um comentário: uma só, em até 7 dias. */
function PrivateReplyDialog({
  comment,
  busy,
  run,
}: {
  comment: InstagramCommentView;
  busy: boolean;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const ready = body.trim().length > 0 && bytesOf(body.trim()) <= MAX_BYTES;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageCircle /> Responder em particular
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Resposta privada para @${comment.authorHandle}`}
        description={`Chega no Direct de quem comentou. A Meta aceita uma resposta por comentário, até ${formatDateTime(comment.privateReply.deadline)}.`}
      >
        <div className="space-y-4">
          {comment.body ? (
            <p className="rounded-md border border-dashed p-2 text-sm">“{comment.body}”</p>
          ) : null}
          <TextBox id="igPrivateReply" label="Mensagem" value={body} onChange={setBody} />
          <div className="flex justify-end">
            <Button
              disabled={busy || !ready}
              onClick={async () => {
                const ok = await run(
                  () =>
                    api(`/instagram/comments/${comment.id}/private-reply`, {
                      method: 'POST',
                      body: { body, clientRequestId: requestId },
                    }),
                  'Resposta privada na fila de envio.',
                );
                if (ok) {
                  setOpen(false);
                  setBody('');
                  setRequestId(newRequestId());
                }
              }}
            >
              <Send /> Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Comments({
  comments,
  canEdit,
  busy,
  run,
}: {
  comments: InstagramCommentView[];
  canEdit: boolean;
  busy: boolean;
  run: Run;
}) {
  if (comments.length === 0) return null;
  return (
    <section className="space-y-2 border-t pt-3" aria-label="Comentários no Instagram da Docline">
      <h3 className="text-sm font-medium">Comentários nas publicações da Docline</h3>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className="rounded-md border p-2 text-sm" data-testid="instagram-comment">
            <p className="whitespace-pre-line">{c.body ?? '(sem texto)'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              @{c.authorHandle}
              {c.isReply ? ' respondeu a um comentário' : ''} · {formatDateTime(c.commentedAt)}
            </p>
            {c.privateReply.state === 'sent' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Resposta privada: {c.privateReply.statusLabel}
                {c.privateReply.sentAt ? ` em ${formatDateTime(c.privateReply.sentAt)}` : ''}
              </p>
            ) : c.privateReply.state === 'expired' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Prazo da resposta privada (7 dias) encerrado.
              </p>
            ) : canEdit ? (
              <div className="mt-2">
                <PrivateReplyDialog comment={c} busy={busy} run={run} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Composer({
  leadId,
  profile,
  busy,
  run,
}: {
  leadId: string;
  profile: InstagramProfileView;
  busy: boolean;
  run: Run;
}) {
  const [body, setBody] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const ready = body.trim().length > 0 && bytesOf(body.trim()) <= MAX_BYTES;
  return (
    <div className="space-y-3 border-t pt-3" data-testid="instagram-composer">
      <p className="text-xs text-muted-foreground">
        @{profile.handle} escreveu para a Docline: dá para responder até{' '}
        {formatDateTime(profile.window.expiresAt!)}.
      </p>
      <TextBox id="igBody" label="Resposta" value={body} onChange={setBody} />
      <div className="flex justify-end">
        <Button
          disabled={busy || !ready}
          onClick={async () => {
            const ok = await run(
              () =>
                api(`/leads/${leadId}/instagram/messages`, {
                  method: 'POST',
                  body: { body, clientRequestId: requestId },
                }),
              'Mensagem na fila de envio.',
            );
            if (ok) {
              setBody('');
              setRequestId(newRequestId());
            }
          }}
        >
          <Send /> Responder pelo Instagram
        </Button>
      </div>
    </div>
  );
}

/**
 * Instagram pela API na ficha do lead (F8-02 a F8-04): os @ com as métricas
 * públicas (Business Discovery), a conversa com a janela de 24 h, os
 * comentários nas publicações da Docline e a resposta. Iniciar conversa
 * continua pelo app (contato assistido); a API só responde.
 */
export function InstagramCard({
  leadId,
  data,
  canEdit,
}: {
  leadId: string;
  data: LeadInstagramView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { run, notice, busy } = useAction();
  const pending = data.messages.some((m) => m.status === 'QUEUED');
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 3000);
    const stop = setTimeout(() => clearInterval(timer), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [pending, router]);

  const editable = canEdit && data.leadActive;
  const replyTo = data.profiles.find((p) => p.usable && p.window.open);
  return (
    <Card data-testid="instagram-card">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Instagram pela API</CardTitle>
        {data.provider === 'fake' ? <Badge variant="warning">Simulado</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {data.profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum Instagram cadastrado.</p>
        ) : (
          <ul className="space-y-2" aria-label="Perfis do Instagram">
            {data.profiles.map((p) => (
              <li key={p.contactPointId} className="space-y-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <a
                    href={p.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                  >
                    @{p.handle} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                  {p.window.open ? (
                    <Badge>Janela aberta até {formatDateTime(p.window.expiresAt!)}</Badge>
                  ) : null}
                </span>
                <Metrics profile={p} />
              </li>
            ))}
          </ul>
        )}
        {editable && data.discoveryEnabled && data.profiles.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => api(`/leads/${leadId}/instagram/refresh`, { method: 'POST', body: {} }),
                'Métricas do Instagram atualizadas.',
              )
            }
          >
            <RefreshCw /> Atualizar métricas
          </Button>
        ) : null}
        <Thread messages={data.messages} canEdit={editable} busy={busy} run={run} />
        <Comments comments={data.comments} canEdit={editable} busy={busy} run={run} />
        {editable ? (
          data.gate?.allowed && replyTo ? (
            <Composer leadId={leadId} profile={replyTo} busy={busy} run={run} />
          ) : (
            <p className="border-t pt-3 text-sm text-muted-foreground">
              {data.gate?.reasons.join(' ') || 'Resposta pela API indisponível.'}
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
