'use client';

import {
  CHANNEL_LABELS,
  REPLY_CLASSIFICATIONS,
  REPLY_CLASSIFICATION_LABELS,
  detectOptOut,
} from '@docline/core/messaging-domain';
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_TYPE_LABELS } from '@docline/core/tasks-domain';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { fromLocalInput, toLocalInput, type TaskRef } from './shared';

type Kind = 'CALL' | 'MEETING' | 'VISIT' | 'MESSAGE';

const OUTCOMES_BY_KIND: Record<
  Exclude<Kind, 'MESSAGE'>,
  (keyof typeof ACTIVITY_OUTCOME_LABELS)[]
> = {
  CALL: ['CONNECTED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER'],
  MEETING: ['HELD', 'NO_SHOW'],
  VISIT: ['HELD', 'NO_SHOW'],
};

/**
 * "Registrar contato" (MVP M13): ligação, reunião ou visita, ou uma mensagem
 * já enviada fora do fluxo. Ligação atendida e reunião realizada contam como
 * contato feito.
 */
export function LogContactDialog({
  lead,
  task,
  onClose,
  onDone,
}: {
  lead: { id: string; displayName: string };
  task?: TaskRef | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('CALL');
  const [outcome, setOutcome] = useState<string>('CONNECTED');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [channel, setChannel] = useState('WHATSAPP');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'MESSAGE') {
        await api(`/leads/${lead.id}/messages/logged`, {
          method: 'POST',
          body: {
            channel,
            body: notes || null,
            sentAt: fromLocalInput(when),
            taskId: task?.id ?? null,
          },
        });
      } else {
        await api(`/leads/${lead.id}/activities`, {
          method: 'POST',
          body: {
            type: kind,
            outcome,
            occurredAt: fromLocalInput(when),
            durationMinutes: minutes ? Number(minutes) : null,
            notes: notes || null,
            taskId: task?.id ?? null,
          },
        });
      }
      onDone('Contato registrado.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent title="Registrar contato" description={lead.displayName}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="O que foi feito" htmlFor="logKind">
            <Select
              id="logKind"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as Kind;
                setKind(next);
                if (next !== 'MESSAGE') setOutcome(OUTCOMES_BY_KIND[next][0]!);
              }}
            >
              <option value="CALL">{ACTIVITY_TYPE_LABELS.CALL}</option>
              <option value="MEETING">{ACTIVITY_TYPE_LABELS.MEETING}</option>
              <option value="VISIT">{ACTIVITY_TYPE_LABELS.VISIT}</option>
              <option value="MESSAGE">Mensagem enviada fora do sistema</option>
            </Select>
          </Field>
          {kind === 'MESSAGE' ? (
            <Field label="Canal" htmlFor="logChannel">
              <Select id="logChannel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'SMS', 'OTHER'].map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Resultado" htmlFor="logOutcome">
              <Select id="logOutcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES_BY_KIND[kind].map((o) => (
                  <option key={o} value={o}>
                    {ACTIVITY_OUTCOME_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quando" htmlFor="logWhen">
              <Input
                id="logWhen"
                type="datetime-local"
                value={when}
                max={toLocalInput(new Date())}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
            {kind !== 'MESSAGE' ? (
              <Field label="Duração (min)" htmlFor="logMinutes">
                <Input
                  id="logMinutes"
                  type="number"
                  min={0}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <Field
            label={kind === 'MESSAGE' ? 'Texto enviado (opcional)' : 'Anotações'}
            htmlFor="logNotes"
          >
            <Textarea id="logNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !when}>
              Registrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Registrar resposta" (MVP M13/M14): o SDR cola o que o lead respondeu.
 * Palavras de opt-out aparecem em destaque já ao digitar; a regra vale no
 * servidor mesmo com outra classificação escolhida.
 */
export function ReplyDialog({
  lead,
  optOutKeywords,
  onClose,
  onDone,
}: {
  lead: { id: string; displayName: string };
  optOutKeywords: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [channel, setChannel] = useState('WHATSAPP');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [classification, setClassification] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detection = detectOptOut(body, optOutKeywords);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ optOut: { level: string } }>(`/leads/${lead.id}/replies`, {
        method: 'POST',
        body: {
          channel,
          body,
          receivedAt: fromLocalInput(when),
          classification: classification || null,
          outOfOfficeUntil:
            classification === 'OUT_OF_OFFICE' && until ? fromLocalInput(until) : null,
        },
      });
      onDone(
        result.optOut.level === 'CERTAIN'
          ? 'Resposta registrada. Pedido de opt-out: o lead entrou na Lista Não Contatar.'
          : 'Resposta registrada.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent title="Registrar resposta" description={lead.displayName} className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Canal" htmlFor="replyChannel">
              <Select
                id="replyChannel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE', 'SMS', 'OTHER'].map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Recebida em" htmlFor="replyWhen">
              <Input
                id="replyWhen"
                type="datetime-local"
                value={when}
                max={toLocalInput(new Date())}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
          </div>
          <Field label="O que o lead respondeu" htmlFor="replyBody">
            <Textarea
              id="replyBody"
              rows={5}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          {detection.level === 'CERTAIN' ? (
            <Alert variant="error" title="Pedido de opt-out">
              A resposta contém “{detection.match}”. Ao registrar, o lead entra na Lista Não
              Contatar e a cadência para.
            </Alert>
          ) : detection.level === 'POSSIBLE' ? (
            <Alert title="Pode ser um pedido de opt-out">
              Aparece “{detection.match}”. Se for pedido para não ser contatado, classifique como “
              {REPLY_CLASSIFICATION_LABELS.OPT_OUT}”.
            </Alert>
          ) : null}
          <Field label="Classificação" htmlFor="replyClassification">
            <Select
              id="replyClassification"
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
              <option value="">Classificar depois</option>
              {REPLY_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {REPLY_CLASSIFICATION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          {classification === 'OUT_OF_OFFICE' ? (
            <Field label="Ausente até" htmlFor="replyUntil" hint="Padrão: 7 dias.">
              <Input
                id="replyUntil"
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          ) : null}
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !body.trim()}>
              Registrar resposta
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reagendar uma tarefa (M11): nova data e, se quiser, o motivo. */
export function RescheduleDialog({
  task,
  onClose,
  onDone,
}: {
  task: { id: string; title: string; dueAt: string | Date };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [when, setWhen] = useState(() =>
    toLocalInput(new Date(Math.max(new Date(task.dueAt).getTime(), Date.now() + 3_600_000))),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { dueAt: fromLocalInput(when), reason: reason || null },
      });
      onDone('Tarefa reagendada.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível reagendar.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent title="Reagendar tarefa" description={task.title}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Nova data" htmlFor="rescheduleWhen">
            <Input
              id="rescheduleWhen"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field label="Motivo (opcional)" htmlFor="rescheduleReason">
            <Input
              id="rescheduleReason"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !when}>
              Reagendar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
