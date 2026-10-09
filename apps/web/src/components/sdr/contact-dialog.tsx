'use client';

import { CHANNEL_LABELS, MESSAGE_TYPE_LABELS } from '@docline/core/messaging-domain';
import { Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const response = await api<Prepared>(`/leads/${lead.id}/messages/assisted`, {
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
                disabled={Boolean(task?.messageType)}
              >
                {TYPES_FOR_CONTACT.map((t) => (
                  <option key={t} value={t}>
                    {MESSAGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
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
              />
            </Field>
            {error ? <Alert variant="error">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || !gate || !result?.allowed || !body.trim()}>
                Preparar envio
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
