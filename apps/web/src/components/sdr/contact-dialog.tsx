'use client';

import type { GenerationView } from '@docline/core';
import { OUTREACH_KINDS } from '@docline/core/ai-domain';
import { CHANNEL_LABELS, MESSAGE_TYPE_LABELS } from '@docline/core/messaging-domain';
import { Copy, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DraftNotes, DraftRating } from '@/components/ai/draft-notes';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { type ContactabilityView, type MessageView, type TaskRef } from './shared';

type AssistedChannel = 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL';
const CHANNELS: AssistedChannel[] = ['WHATSAPP', 'INSTAGRAM', 'EMAIL'];
const TYPES_FOR_CONTACT = [
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'INTERESTED_REPLY',
  'OBJECTION_REPLY',
  'SCHEDULING',
  'REACTIVATION',
  'OTHER',
] as const;

interface Prepared {
  message: MessageView;
  link: string | null;
}

interface ApproachOption {
  id: string;
  name: string;
}

const DISCARD_REASONS = [
  'Texto genérico',
  'Informação errada ou inventada',
  'Tom inadequado',
  'Longo demais',
  'Prefiro escrever do meu jeito',
];

const isOutreachKind = (value: string): value is (typeof OUTREACH_KINDS)[number] =>
  (OUTREACH_KINDS as readonly string[]).includes(value);

/**
 * Contato assistido (MVP M13; docs/SDR-FLOW.md §6): o gate decide o canal, o
 * SDR escreve, abre o app com o texto e envia ele mesmo; depois confirma. Sem
 * confirmação, o envio fica pendente na fila.
 */
export function ContactDialog({
  lead,
  task,
  defaultChannel,
  defaultContactPointId,
  onClose,
  onDone,
}: {
  lead: { id: string; displayName: string };
  task?: TaskRef | null;
  defaultChannel?: AssistedChannel;
  /** Contato escolhido na ficha (botão do próprio telefone, e-mail ou perfil). */
  defaultContactPointId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [gate, setGate] = useState<ContactabilityView | null>(null);
  const [channel, setChannel] = useState<AssistedChannel>(
    defaultChannel ??
      (task?.channel && CHANNELS.includes(task.channel as AssistedChannel)
        ? (task.channel as AssistedChannel)
        : 'WHATSAPP'),
  );
  const [contactPointId, setContactPointId] = useState(defaultContactPointId ?? '');
  const [messageType, setMessageType] = useState(task?.messageType ?? 'OTHER');
  const [body, setBody] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Rascunho da IA (M12): o texto vai para a mensagem e só sai com aprovação.
  const [draft, setDraft] = useState<GenerationView | null>(null);
  const [checkedText, setCheckedText] = useState('');
  const [approaches, setApproaches] = useState<ApproachOption[] | null>(null);
  // Lead de campanha com teste A/B: a abordagem sorteada já vem escolhida.
  const [approachId, setApproachId] = useState(task?.campaign?.approach?.id ?? '');
  const [instructions, setInstructions] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [discardReason, setDiscardReason] = useState(DISCARD_REASONS[0]!);

  useEffect(() => {
    let cancelled = false;
    api<ContactabilityView>(`/leads/${lead.id}/contactability`)
      .then((result) => {
        if (!cancelled) setGate(result);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Falha ao consultar o gate.');
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  const result = gate?.channels.find((c) => c.channel === channel);
  const usable = (gate?.contactPoints ?? []).filter((cp) =>
    result?.usableContactPointIds.includes(cp.id),
  );
  // O que a tela mostra é o que vai no envio (o principal, se nada foi escolhido).
  const selected = usable.find((cp) => cp.id === contactPointId) ?? usable[0];

  function loadApproaches() {
    if (approaches) return;
    api<{ data: ApproachOption[] }>('/approaches')
      .then((result) => setApproaches(result.data))
      .catch(() => setApproaches([]));
  }

  async function generate() {
    if (!isOutreachKind(messageType)) return;
    setBusy(true);
    setError(null);
    setDiscarding(false);
    try {
      const result = await api<GenerationView>('/ai/generations', {
        method: 'POST',
        body: {
          leadId: lead.id,
          kind: messageType,
          channel,
          approachId: approachId || null,
          instructions: instructions.trim() || null,
          replacesGenerationId: draft?.id ?? null,
        },
      });
      if (result.status === 'BLOCKED') {
        setDraft(null);
        setError(
          `A IA não gera mensagem para este lead agora: ${result.flags.map((f) => f.message).join(' ')}`,
        );
        return;
      }
      setDraft(result);
      setBody(result.text ?? '');
      setCheckedText(result.text ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o rascunho.');
    } finally {
      setBusy(false);
    }
  }

  /** Texto editado: confere de novo os guardrails (sem chamar a IA). */
  async function recheck() {
    if (!draft || !body.trim() || body === checkedText) return;
    try {
      const result = await api<GenerationView>(`/ai/generations/${draft.id}`, {
        method: 'PATCH',
        body: { text: body },
      });
      setDraft(result);
      setCheckedText(body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conferir o texto.');
    }
  }

  async function discard() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/ai/generations/${draft.id}/discard`, {
        method: 'POST',
        body: { reason: discardReason },
      });
      if (body === draft.text || body === draft.textGenerated) setBody('');
      setDraft(null);
      setDiscarding(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível descartar.');
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const response = draft
        ? await api<Prepared>(`/ai/generations/${draft.id}/approve`, {
            method: 'POST',
            body: { text: body, contactPointId: selected?.id ?? null, taskId: task?.id ?? null },
          })
        : await api<Prepared>(`/leads/${lead.id}/messages/assisted`, {
            method: 'POST',
            body: {
              channel,
              contactPointId: selected?.id ?? null,
              body,
              messageType,
              taskId: task?.id ?? null,
            },
          });
      setPrepared(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível preparar o envio.');
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      setError('Não foi possível copiar: selecione o texto e copie manualmente.');
    }
  }

  async function finish(action: 'confirm' | 'cancel') {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/messages/${prepared.message.id}/${action}`, { method: 'POST', body: {} });
      onDone(action === 'confirm' ? 'Envio registrado.' : 'Envio cancelado.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        title={prepared ? 'Envie e confirme' : 'Enviar mensagem'}
        description={
          <>
            {lead.displayName}
            {task ? ` · ${task.title}` : ''}
            {task?.campaign?.approach
              ? ` · campanha “${task.campaign.name}”, abordagem ${task.campaign.approach.name}`
              : ''}
          </>
        }
        className="max-w-lg"
      >
        {!prepared ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
          >
            <Field label="Canal" htmlFor="contactChannel">
              <Select
                id="contactChannel"
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as AssistedChannel);
                  setContactPointId('');
                }}
                disabled={Boolean(draft)}
              >
                {CHANNELS.map((c) => {
                  const r = gate?.channels.find((g) => g.channel === c);
                  return (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                      {r && !r.allowed ? ' — bloqueado' : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
            {result && !result.allowed ? (
              <Alert variant="error" title="Contato não permitido agora">
                {result.reasons.join(' ')}
                {result.availableAt ? ` Liberado em ${formatDateTime(result.availableAt)}.` : ''}
              </Alert>
            ) : null}
            {usable.length > 1 ? (
              <Field label="Contato" htmlFor="contactPoint">
                <Select
                  id="contactPoint"
                  value={selected?.id}
                  onChange={(e) => setContactPointId(e.target.value)}
                >
                  {usable.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.display}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : selected ? (
              <p className="text-sm text-muted-foreground">Para: {selected.display}</p>
            ) : null}
            <Field label="Tipo de mensagem" htmlFor="contactMessageType">
              <Select
                id="contactMessageType"
                value={messageType}
                onChange={(e) => setMessageType(e.target.value)}
                disabled={Boolean(task?.messageType) || Boolean(draft)}
              >
                {TYPES_FOR_CONTACT.map((t) => (
                  <option key={t} value={t}>
                    {MESSAGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generate}
                  disabled={busy || !result?.allowed || !isOutreachKind(messageType)}
                >
                  {draft ? <RefreshCw /> : <Sparkles />}
                  {draft ? 'Gerar de novo' : 'Gerar com IA'}
                </Button>
                {draft ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setDiscarding((v) => !v)}
                  >
                    Descartar rascunho
                  </Button>
                ) : null}
                {!isOutreachKind(messageType) ? (
                  <span className="text-xs text-muted-foreground">
                    Escolha o tipo de mensagem para gerar com IA.
                  </span>
                ) : null}
              </div>
              <details onToggle={loadApproaches}>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Orientar a IA (opcional)
                </summary>
                <div className="mt-2 space-y-2">
                  <Field label="Abordagem" htmlFor="aiApproach">
                    <Select
                      id="aiApproach"
                      value={approachId}
                      onChange={(e) => setApproachId(e.target.value)}
                    >
                      <option value="">Sem abordagem específica</option>
                      {(approaches ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Instruções para a IA"
                    htmlFor="aiInstructions"
                    hint="Ex.: mencionar o evento do CRC. Não coloque telefones, e-mails ou links."
                  >
                    <Textarea
                      id="aiInstructions"
                      rows={2}
                      maxLength={500}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                    />
                  </Field>
                </div>
              </details>
              {discarding && draft ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Por que descartar?" htmlFor="aiDiscardReason">
                    <Select
                      id="aiDiscardReason"
                      value={discardReason}
                      onChange={(e) => setDiscardReason(e.target.value)}
                    >
                      {DISCARD_REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={discard}
                  >
                    Confirmar descarte
                  </Button>
                </div>
              ) : null}
              {draft ? (
                <DraftNotes
                  draft={draft}
                  onApplySuggestion={(text) => setBody((current) => `${current.trimEnd()} ${text}`)}
                />
              ) : null}
            </div>
            <Field
              label="Mensagem"
              htmlFor="contactBody"
              hint="Você envia pelo app; nada sai automaticamente. Inclua sempre como parar de receber."
            >
              <Textarea
                id="contactBody"
                rows={6}
                maxLength={4000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onBlur={() => void recheck()}
              />
            </Field>
            {error ? <Alert variant="error">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || !gate || !result?.allowed || !body.trim()}>
                {draft ? 'Aprovar e preparar envio' : 'Preparar envio'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="whitespace-pre-line rounded-md border bg-muted/40 p-3 text-sm">{body}</p>
            <div className="flex flex-wrap gap-2">
              {channel === 'INSTAGRAM' ? (
                <Button variant="outline" onClick={copyText}>
                  <Copy /> {copied ? 'Texto copiado' : 'Copiar texto'}
                </Button>
              ) : null}
              {prepared.link ? (
                <Button asChild>
                  <a href={prepared.link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    {channel === 'WHATSAPP'
                      ? 'Abrir no WhatsApp'
                      : channel === 'INSTAGRAM'
                        ? 'Abrir o Instagram'
                        : 'Abrir o e-mail'}
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Enviou? Confirme para registrar o contato e avançar a cadência. Se não enviou,
              cancele.
            </p>
            {draft ? <DraftRating generationId={draft.id} /> : null}
            {error ? <Alert variant="error">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => finish('cancel')}>
                Não enviei
              </Button>
              <Button disabled={busy} onClick={() => finish('confirm')}>
                Confirmar envio
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
