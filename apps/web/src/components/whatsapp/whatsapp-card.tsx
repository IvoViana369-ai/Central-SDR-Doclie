'use client';

import { renderTemplate } from '@docline/core/whatsapp-domain';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface WhatsappNumberView {
  contactPointId: string;
  display: string;
  whatsappStatus: string;
  optIn: { status: string; method: string | null; at: Date_ | null; evidence: string | null };
  window: { open: boolean; expiresAt: Date_ | null };
  lastInboundAt: Date_ | null;
  profileName: string | null;
  recentInbound: { id: string; excerpt: string; receivedAt: Date_ | null }[];
  usable: boolean;
}

export interface WhatsappMessageView {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  statusLabel: string;
  body: string | null;
  contactPointId: string | null;
  createdAt: Date_;
  sentAt: Date_ | null;
  deliveredAt: Date_ | null;
  readAt: Date_ | null;
  receivedAt: Date_ | null;
  failedAt: Date_ | null;
  errorCode: string | null;
  errorDetail: string | null;
  templateName: string | null;
  sentBy: { name: string } | null;
  retry: 'none' | 'allowed' | 'wait' | 'confirm';
}

export interface WhatsappTemplateView {
  id: string;
  name: string;
  language: string;
  categoryLabel: string;
  bodyText: string;
  bodyParameters: string[];
  approachName: string | null;
}

export interface LeadWhatsappView {
  provider: string | null;
  leadActive: boolean;
  gate: { allowed: boolean; reasons: string[] } | null;
  numbers: WhatsappNumberView[];
  messages: WhatsappMessageView[];
  templates: WhatsappTemplateView[];
}

const OPT_IN_METHODS: Record<string, string> = {
  INBOUND_MESSAGE: 'O contato escreveu concordando',
  FORM: 'Formulário',
  EVENT: 'Evento',
  EXISTING_RELATIONSHIP: 'Relacionamento existente',
  VERBAL_RECORDED: 'Verbal, registrado',
  CLICK_TO_WHATSAPP: 'Anúncio "clique para WhatsApp"',
};

const newRequestId = () => crypto.randomUUID();

type Run = ReturnType<typeof useAction>['run'];

function StatusIcon({ status }: { status: string }) {
  if (status === 'READ') return <CheckCheck className="size-3.5 text-primary" aria-hidden />;
  if (status === 'DELIVERED') return <CheckCheck className="size-3.5" aria-hidden />;
  if (status === 'SENT') return <Check className="size-3.5" aria-hidden />;
  if (status === 'FAILED')
    return <AlertTriangle className="size-3.5 text-destructive" aria-hidden />;
  return <Clock className="size-3.5" aria-hidden />;
}

/** Registrar o opt-in de um número: mensagem do contato (qualquer SDR) ou evidência (GESTOR/ADMIN). */
function OptInDialog({
  leadId,
  number,
  canRecordEvidence,
  run,
}: {
  leadId: string;
  number: WhatsappNumberView;
  canRecordEvidence: boolean;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('INBOUND_MESSAGE');
  const [messageId, setMessageId] = useState(number.recentInbound[0]?.id ?? '');
  const [evidence, setEvidence] = useState('');
  const inbound = method === 'INBOUND_MESSAGE';
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ShieldCheck /> Registrar opt-in
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Opt-in do WhatsApp — ${number.display}`}
        description="A Meta exige a permissão do próprio número para mensagens da empresa pela API. Não substitui a base legal."
      >
        <div className="space-y-4">
          <Field label="Como o opt-in foi obtido" htmlFor="optInMethod">
            <Select id="optInMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(OPT_IN_METHODS)
                .filter(([value]) => value === 'INBOUND_MESSAGE' || canRecordEvidence)
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </Select>
          </Field>
          {inbound ? (
            number.recentInbound.length > 0 ? (
              <Field
                label="Mensagem em que o contato concordou"
                htmlFor="optInMessage"
                hint="Só mensagens recebidas deste número pelo WhatsApp."
              >
                <Select
                  id="optInMessage"
                  value={messageId}
                  onChange={(e) => setMessageId(e.target.value)}
                >
                  {number.recentInbound.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.receivedAt ? formatDateTime(m.receivedAt) : ''} — {m.excerpt}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma mensagem recebida deste número pelo WhatsApp.
                {canRecordEvidence ? ' Use outro método, com a evidência.' : ''}
              </p>
            )
          ) : (
            <Field
              label="Evidência"
              htmlFor="optInEvidence"
              hint="Documento, data e link (ex.: formulário do evento de 10/10)."
            >
              <Textarea
                id="optInEvidence"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </Field>
          )}
          <div className="flex justify-end">
            <Button
              disabled={inbound ? !messageId : !evidence.trim()}
              onClick={async () => {
                const ok = await run(
                  () =>
                    api(`/leads/${leadId}/whatsapp/opt-in`, {
                      method: 'POST',
                      body: {
                        contactPointId: number.contactPointId,
                        method,
                        ...(inbound ? { evidenceMessageId: messageId } : { evidence }),
                      },
                    }),
                  'Opt-in registrado.',
                );
                if (ok) setOpen(false);
              }}
            >
              Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
                  api(`/messages/${messageId}/retry`, {
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
  messages: WhatsappMessageView[];
  canEdit: boolean;
  busy: boolean;
  run: Run;
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma mensagem pela API ainda.</p>;
  }
  return (
    <ol className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Conversa pelo WhatsApp">
      {messages.map((m) => {
        const inbound = m.direction === 'INBOUND';
        return (
          <li
            key={m.id}
            data-testid="whatsapp-message"
            className={cn(
              'max-w-[85%] rounded-lg border p-2 text-sm',
              inbound ? 'mr-auto bg-card' : 'ml-auto bg-accent/40',
            )}
          >
            {m.templateName ? (
              <p className="text-xs text-muted-foreground">Modelo {m.templateName}</p>
            ) : null}
            {m.body ? <p className="whitespace-pre-line">{m.body}</p> : null}
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {inbound ? null : <StatusIcon status={m.status} />}
              {inbound ? 'Recebida' : m.statusLabel} ·{' '}
              {formatDateTime(m.receivedAt ?? m.readAt ?? m.deliveredAt ?? m.sentAt ?? m.createdAt)}
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
                        () => api(`/messages/${m.id}/retry`, { method: 'POST', body: {} }),
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

function Composer({
  leadId,
  data,
  busy,
  run,
}: {
  leadId: string;
  data: LeadWhatsappView;
  busy: boolean;
  run: Run;
}) {
  const usable = data.numbers.filter((n) => n.usable);
  const [contactPointId, setContactPointId] = useState(usable[0]?.contactPointId ?? '');
  const number = usable.find((n) => n.contactPointId === contactPointId) ?? usable[0];
  const canText = Boolean(number?.window.open);
  const canTemplate = number?.optIn.status === 'GRANTED' && data.templates.length > 0;
  const [kind, setKind] = useState<'text' | 'template'>(canText ? 'text' : 'template');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState(data.templates[0]?.id ?? '');
  const [params, setParams] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState(newRequestId);
  const template = data.templates.find((t) => t.id === templateId);
  const preview = useMemo(
    () => (template ? renderTemplate(template.bodyText, params) : ''),
    [template, params],
  );

  if (!number) return null;
  const effectiveKind = kind === 'text' && !canText ? 'template' : kind;
  const ready =
    effectiveKind === 'text'
      ? canText && body.trim().length > 0
      : canTemplate &&
        Boolean(template) &&
        template!.bodyParameters.every((p) => (params[p] ?? '').trim().length > 0);

  async function send() {
    const ok = await run(
      () =>
        api(`/leads/${leadId}/whatsapp/messages`, {
          method: 'POST',
          body:
            effectiveKind === 'text'
              ? {
                  kind: 'text',
                  contactPointId: number!.contactPointId,
                  body,
                  clientRequestId: requestId,
                }
              : {
                  kind: 'template',
                  contactPointId: number!.contactPointId,
                  templateId,
                  params,
                  clientRequestId: requestId,
                },
        }),
      'Mensagem na fila de envio.',
    );
    if (ok) {
      setBody('');
      setParams({});
      setRequestId(newRequestId());
    }
  }

  return (
    <div className="space-y-3 border-t pt-3" data-testid="whatsapp-composer">
      {usable.length > 1 ? (
        <Field label="Número" htmlFor="waNumber">
          <Select
            id="waNumber"
            value={number.contactPointId}
            onChange={(e) => setContactPointId(e.target.value)}
          >
            {usable.map((n) => (
              <option key={n.contactPointId} value={n.contactPointId}>
                {n.display}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de mensagem">
        <Button
          size="sm"
          role="tab"
          aria-selected={effectiveKind === 'text'}
          variant={effectiveKind === 'text' ? 'default' : 'outline'}
          disabled={!canText}
          onClick={() => setKind('text')}
        >
          Mensagem
        </Button>
        <Button
          size="sm"
          role="tab"
          aria-selected={effectiveKind === 'template'}
          variant={effectiveKind === 'template' ? 'default' : 'outline'}
          disabled={!canTemplate}
          onClick={() => setKind('template')}
        >
          Modelo aprovado
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {canText
          ? `Janela aberta até ${formatDateTime(number.window.expiresAt!)}: dá para responder com texto livre.`
          : 'Fora da janela de 24 h da última mensagem do contato: só modelo aprovado.'}
        {!canTemplate && number.optIn.status !== 'GRANTED'
          ? ' Modelos exigem o opt-in do número.'
          : ''}
      </p>
      {effectiveKind === 'text' ? (
        <Field label="Mensagem" htmlFor="waBody">
          <Textarea
            id="waBody"
            value={body}
            maxLength={4096}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
      ) : canTemplate ? (
        <div className="space-y-3">
          <Field label="Modelo" htmlFor="waTemplate">
            <Select
              id="waTemplate"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setParams({});
              }}
            >
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.categoryLabel}
                  {t.approachName ? ` · ${t.approachName}` : ''})
                </option>
              ))}
            </Select>
          </Field>
          {template?.bodyParameters.map((p) => (
            <Field
              key={p}
              label={/^\d+$/.test(p) ? `Variável ${p}` : `Variável "${p}"`}
              htmlFor={`waParam-${p}`}
            >
              <Input
                id={`waParam-${p}`}
                value={params[p] ?? ''}
                maxLength={200}
                onChange={(e) => setParams({ ...params, [p]: e.target.value })}
              />
            </Field>
          ))}
          <div className="rounded-md border border-dashed p-2 text-sm" aria-label="Prévia">
            <p className="mb-1 text-xs text-muted-foreground">Prévia</p>
            <p className="whitespace-pre-line">{preview}</p>
          </div>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={busy || !ready} onClick={send}>
          <Send /> Enviar pelo WhatsApp
        </Button>
      </div>
    </div>
  );
}

/**
 * WhatsApp pela API na ficha do lead (F7-03, F7-05): números com opt-in e
 * janela de atendimento, conversa com status de entrega e o envio (texto na
 * janela, modelo aprovado com opt-in). O envio sai pelo worker; enquanto há
 * mensagem na fila, a seção se atualiza sozinha.
 */
export function WhatsappCard({
  leadId,
  data,
  canEdit,
  canRecordEvidence,
}: {
  leadId: string;
  data: LeadWhatsappView;
  canEdit: boolean;
  canRecordEvidence: boolean;
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
  return (
    <Card data-testid="whatsapp-card">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>WhatsApp pela API</CardTitle>
        {data.provider === 'fake' ? <Badge variant="warning">Simulado</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum celular com WhatsApp cadastrado.</p>
        ) : (
          <ul className="space-y-2" aria-label="Números do WhatsApp">
            {data.numbers.map((n) => (
              <li
                key={n.contactPointId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.display}</span>
                  {n.optIn.status === 'GRANTED' ? (
                    <Badge variant="success" title={n.optIn.evidence ?? undefined}>
                      Opt-in{n.optIn.at ? ` desde ${formatDateTime(n.optIn.at)}` : ''}
                    </Badge>
                  ) : n.optIn.status === 'REVOKED' ? (
                    <Badge variant="destructive">Opt-in revogado</Badge>
                  ) : (
                    <Badge variant="muted">Sem opt-in</Badge>
                  )}
                  {n.window.open ? (
                    <Badge>Janela aberta até {formatDateTime(n.window.expiresAt!)}</Badge>
                  ) : null}
                </span>
                {editable ? (
                  n.optIn.status === 'GRANTED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api(`/leads/${leadId}/whatsapp/opt-in/revoke`, {
                              method: 'POST',
                              body: { contactPointId: n.contactPointId },
                            }),
                          'Opt-in revogado.',
                        )
                      }
                    >
                      <ShieldOff /> Revogar opt-in
                    </Button>
                  ) : (
                    <OptInDialog
                      leadId={leadId}
                      number={n}
                      canRecordEvidence={canRecordEvidence}
                      run={run}
                    />
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Thread messages={data.messages} canEdit={editable} busy={busy} run={run} />
        {editable ? (
          data.gate?.allowed ? (
            <Composer leadId={leadId} data={data} busy={busy} run={run} />
          ) : (
            <p className="border-t pt-3 text-sm text-muted-foreground">
              {data.gate?.reasons.join(' ') ?? 'Envio pela API indisponível.'}
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
