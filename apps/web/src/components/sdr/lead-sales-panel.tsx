'use client';

import { STEP_TASK_TITLES, type ENROLLMENT_STATUS_LABELS } from '@docline/core/cadence-domain';
import { CONVERSION_TYPE_LABELS, QUALIFICATION_LABELS } from '@docline/core/opportunities-domain';
import { Check, MessageSquarePlus, PhoneCall, Reply, Send } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { ContactDialog } from './contact-dialog';
import { MessageItem } from './message-item';
import { LogContactDialog, ReplyDialog, RescheduleDialog } from './record-dialogs';
import {
  fromLocalInput,
  isContactTask,
  toLocalInput,
  type MessageView,
  type TaskRef,
} from './shared';

export interface TaskView extends TaskRef {
  description: string | null;
  dueAt: string | Date;
  status: string;
  outcome: string | null;
  typeLabel: string;
  overdue: boolean;
  assignee: { id: string; name: string } | null;
}

export interface EnrollmentView {
  id: string;
  cadence: { id: string; name: string };
  status: keyof typeof ENROLLMENT_STATUS_LABELS;
  statusLabel: string;
  stopReasonLabel: string | null;
  currentStepPosition: number | null;
  nextStepDueAt: string | Date | null;
  pausedUntil: string | Date | null;
  enrolledAt: string | Date;
  endedAt: string | Date | null;
  steps: { position: number; dayOffset: number; messageType: string; done: boolean }[];
}

export interface OpportunityView {
  id: string;
  status: 'OPEN' | 'WON' | 'LOST';
  statusLabel: string;
  handoffAt: string | Date;
  acceptDueAt: string | Date;
  acceptedAt: string | Date | null;
  acceptOverdue: boolean;
  qualification: Record<string, unknown>;
  conversionTypeLabel: string | null;
  sdr: { id: string; name: string } | null;
  salesOwner: { id: string; name: string } | null;
  lossReason: { name: string } | null;
}

export interface LeadSalesData {
  tasks: { open: TaskView[]; closed: TaskView[] };
  messages: MessageView[];
  enrollments: EnrollmentView[];
  cadences: { id: string; name: string; isDefault: boolean }[];
  opportunities: OpportunityView[];
  salesOwners: { id: string; name: string; role: string }[];
  lossReasons: { id: string; name: string }[];
  optOutKeywords: string[];
  userId: string;
  privileged: boolean;
  canEdit: boolean;
}

type DialogState =
  | { kind: 'contact'; task?: TaskRef | null }
  | { kind: 'log'; task?: TaskRef | null }
  | { kind: 'reschedule'; task: TaskView }
  | { kind: 'reply' }
  | { kind: 'handoff' }
  | null;

/**
 * Operação do SDR na ficha do lead (Fase 5): ações de contato, próximas
 * tarefas, cadência, mensagens e respostas, e transferência ao Comercial.
 */
export function LeadSalesPanel({
  lead,
  data,
}: {
  lead: { id: string; displayName: string; status: string };
  data: LeadSalesData;
}) {
  const { run, notice, setNotice, busy } = useAction();
  const [dialog, setDialog] = useState<DialogState>(null);
  const active = lead.status === 'ACTIVE' && data.canEdit;
  const ongoing = data.enrollments.find((e) => e.status === 'ACTIVE' || e.status === 'PAUSED');
  const openOpportunity = data.opportunities.find((o) => o.status === 'OPEN');
  const done = (message: string) => {
    setDialog(null);
    // Recarrega os dados da página (mesmo efeito do useAction).
    void run(async () => null, message);
  };

  return (
    <div className="space-y-4">
      {active ? (
        <div className="flex flex-wrap gap-2" aria-label="Ações de contato">
          <Button onClick={() => setDialog({ kind: 'contact' })}>
            <Send /> Enviar mensagem
          </Button>
          <Button variant="outline" onClick={() => setDialog({ kind: 'log' })}>
            <PhoneCall /> Registrar contato
          </Button>
          <Button variant="outline" onClick={() => setDialog({ kind: 'reply' })}>
            <Reply /> Registrar resposta
          </Button>
          {!openOpportunity ? (
            <Button variant="outline" onClick={() => setDialog({ kind: 'handoff' })}>
              Transferir ao Comercial
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      <TasksCard
        leadId={lead.id}
        tasks={data.tasks}
        canEdit={active}
        busy={busy}
        run={run}
        onContact={(task) => setDialog({ kind: 'contact', task })}
        onLog={(task) => setDialog({ kind: 'log', task })}
        onReschedule={(task) => setDialog({ kind: 'reschedule', task })}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Cadência</CardTitle>
          {active && !ongoing ? (
            <EnrollButton leadId={lead.id} cadences={data.cadences} busy={busy} run={run} />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ongoing ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <strong>{ongoing.cadence.name}</strong>
                <Badge variant={ongoing.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {ongoing.statusLabel}
                </Badge>
              </p>
              <ol className="flex flex-wrap gap-2" aria-label="Passos da cadência">
                {ongoing.steps.map((s) => (
                  <li
                    key={s.position}
                    className={
                      s.done
                        ? 'rounded-full bg-success/15 px-2 py-0.5 text-xs'
                        : s.position === ongoing.currentStepPosition
                          ? 'rounded-full bg-accent px-2 py-0.5 text-xs font-medium'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    D{s.dayOffset} · {STEP_TASK_TITLES[s.messageType] ?? s.messageType}
                  </li>
                ))}
              </ol>
              <p className="text-muted-foreground">
                {ongoing.status === 'PAUSED'
                  ? ongoing.pausedUntil
                    ? `Pausada até ${formatDateTime(ongoing.pausedUntil)}.`
                    : 'Pausada.'
                  : ongoing.currentStepPosition === null
                    ? `Todos os passos feitos. "Sem resposta" em ${formatDateTime(ongoing.nextStepDueAt)}.`
                    : `Próximo passo em ${formatDateTime(ongoing.nextStepDueAt)}.`}
              </p>
              {active ? (
                <div className="flex flex-wrap gap-2">
                  {ongoing.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api(`/leads/${lead.id}/cadence/pause`, { method: 'POST', body: {} }),
                          'Cadência pausada.',
                        )
                      }
                    >
                      Pausar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api(`/leads/${lead.id}/cadence/resume`, { method: 'POST' }),
                          'Cadência retomada.',
                        )
                      }
                    >
                      Retomar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      window.confirm('Encerrar a cadência deste lead?') &&
                      run(
                        () => api(`/leads/${lead.id}/cadence/stop`, { method: 'POST', body: {} }),
                        'Cadência encerrada.',
                      )
                    }
                  >
                    Encerrar
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Fora de cadência.</p>
          )}
          {data.enrollments.filter((e) => e !== ongoing).length > 0 ? (
            <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              {data.enrollments
                .filter((e) => e !== ongoing)
                .map((e) => (
                  <li key={e.id}>
                    {e.cadence.name} · {e.statusLabel}
                    {e.stopReasonLabel ? ` (${e.stopReasonLabel})` : ''} ·{' '}
                    {formatDateTime(e.endedAt ?? e.enrolledAt)}
                  </li>
                ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <MessagesCard messages={data.messages} canEdit={active} busy={busy} run={run} />

      {data.opportunities.length > 0 ? (
        <OpportunityCard
          opportunities={data.opportunities}
          lossReasons={data.lossReasons}
          userId={data.userId}
          privileged={data.privileged}
          busy={busy}
          run={run}
        />
      ) : null}

      {dialog?.kind === 'contact' ? (
        <ContactDialog
          lead={lead}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'log' ? (
        <LogContactDialog
          lead={lead}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'reschedule' ? (
        <RescheduleDialog task={dialog.task} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === 'reply' ? (
        <ReplyDialog
          lead={lead}
          optOutKeywords={data.optOutKeywords}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'handoff' ? (
        <HandoffDialog
          lead={lead}
          salesOwners={data.salesOwners}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setNotice(null);
            done(message);
          }}
        />
      ) : null}
    </div>
  );
}

type Run = ReturnType<typeof useAction>['run'];

function EnrollButton({
  leadId,
  cadences,
  busy,
  run,
}: {
  leadId: string;
  cadences: { id: string; name: string; isDefault: boolean }[];
  busy: boolean;
  run: Run;
}) {
  const [cadenceId, setCadenceId] = useState(
    cadences.find((c) => c.isDefault)?.id ?? cadences[0]?.id ?? '',
  );
  if (cadences.length === 0) return null;
  return (
    <span className="flex items-center gap-2">
      {cadences.length > 1 ? (
        <Select
          aria-label="Cadência"
          className="h-8 w-auto text-xs"
          value={cadenceId}
          onChange={(e) => setCadenceId(e.target.value)}
        >
          {cadences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        size="sm"
        disabled={busy || !cadenceId}
        onClick={() =>
          run(
            () => api(`/leads/${leadId}/cadence`, { method: 'POST', body: { cadenceId } }),
            'Lead inscrito na cadência. O primeiro passo está nas suas tarefas.',
          )
        }
      >
        Inscrever na cadência
      </Button>
    </span>
  );
}

function TasksCard({
  leadId,
  tasks,
  canEdit,
  busy,
  run,
  onContact,
  onLog,
  onReschedule,
}: {
  leadId: string;
  tasks: { open: TaskView[]; closed: TaskView[] };
  canEdit: boolean;
  busy: boolean;
  run: Run;
  onContact: (task: TaskRef) => void;
  onLog: (task: TaskRef) => void;
  onReschedule: (task: TaskView) => void;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Próximas ações</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.open.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa aberta.</p>
        ) : (
          <ul className="divide-y" aria-label="Tarefas abertas">
            {tasks.open.map((t) => (
              <li key={t.id} className="space-y-1.5 py-2 first:pt-0" data-testid="open-task">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <Badge variant="muted">{t.typeLabel}</Badge>
                  <span className={t.overdue ? 'text-destructive' : 'text-muted-foreground'}>
                    {t.overdue ? 'Atrasada · ' : ''}
                    {formatDateTime(t.dueAt)}
                  </span>
                </p>
                {t.description ? (
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                ) : null}
                {canEdit ? (
                  <div className="flex flex-wrap gap-1.5">
                    {isContactTask(t) ? (
                      <Button size="sm" onClick={() => onContact(t)}>
                        <Send /> Contatar
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => onLog(t)}>
                      Registrar contato
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        const outcome = window.prompt('Resultado (opcional):');
                        if (outcome === null) return;
                        void run(
                          () =>
                            api(`/tasks/${t.id}/complete`, {
                              method: 'POST',
                              body: { outcome: outcome || null },
                            }),
                          'Tarefa concluída.',
                        );
                      }}
                    >
                      <Check /> Concluir
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onReschedule(t)}>
                      Reagendar
                    </Button>
                    {t.enrollmentId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => api(`/tasks/${t.id}/skip`, { method: 'POST', body: {} }),
                            'Passo pulado: a cadência seguiu para o próximo.',
                          )
                        }
                      >
                        Pular passo
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_12rem_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(
                () =>
                  api('/tasks', {
                    method: 'POST',
                    body: { leadId, title, dueAt: fromLocalInput(due) },
                  }),
                'Follow-up agendado.',
              );
              if (ok) setTitle('');
            }}
          >
            <Input
              aria-label="Nova tarefa"
              placeholder="Ex.: ligar para o contador"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              aria-label="Vencimento da nova tarefa"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || title.trim().length < 2}
            >
              <MessageSquarePlus /> Agendar
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MessagesCard({
  messages,
  canEdit,
  busy,
  run,
}: {
  messages: MessageView[];
  canEdit: boolean;
  busy: boolean;
  run: Run;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mensagens e respostas</CardTitle>
      </CardHeader>
      <CardContent>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada.</p>
        ) : (
          <ul className="space-y-3" aria-label="Mensagens">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} canEdit={canEdit} busy={busy} run={run} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OpportunityCard({
  opportunities,
  lossReasons,
  userId,
  privileged,
  busy,
  run,
}: {
  opportunities: OpportunityView[];
  lossReasons: { id: string; name: string }[];
  userId: string;
  privileged: boolean;
  busy: boolean;
  run: Run;
}) {
  const [lossReasonId, setLossReasonId] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comercial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {opportunities.map((o) => {
          const canDecide = o.status === 'OPEN' && (privileged || o.salesOwner?.id === userId);
          return (
            <div key={o.id} className="space-y-2" data-testid="opportunity">
              <p className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    o.status === 'WON' ? 'success' : o.status === 'LOST' ? 'destructive' : 'default'
                  }
                >
                  {o.statusLabel}
                </Badge>
                <span>
                  {o.salesOwner?.name ?? 'Sem comercial'} · transferida em{' '}
                  {formatDateTime(o.handoffAt)}
                </span>
              </p>
              {o.status === 'OPEN' ? (
                <p className={o.acceptOverdue ? 'text-destructive' : 'text-muted-foreground'}>
                  {o.acceptedAt
                    ? `Aceita em ${formatDateTime(o.acceptedAt)}.`
                    : `Aceite até ${formatDateTime(o.acceptDueAt)}${o.acceptOverdue ? ' (atrasado)' : ''}.`}
                </p>
              ) : null}
              {o.conversionTypeLabel ? (
                <p>Convertido como {o.conversionTypeLabel.toLowerCase()}.</p>
              ) : null}
              {o.lossReason ? <p>Motivo: {o.lossReason.name}</p> : null}
              <dl className="grid gap-1 text-xs">
                {Object.entries(QUALIFICATION_LABELS).map(([key, label]) => {
                  const value = o.qualification[key];
                  if (value === null || value === undefined || value === '') return null;
                  return (
                    <div key={key} className="grid grid-cols-[10rem_1fr] gap-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{key === 'meetingAt' ? formatDateTime(String(value)) : String(value)}</dd>
                    </div>
                  );
                })}
              </dl>
              {canDecide ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!o.acceptedAt ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api(`/opportunities/${o.id}/accept`, { method: 'POST' }),
                          'Transferência aceita.',
                        )
                      }
                    >
                      Aceitar
                    </Button>
                  ) : null}
                  {(['PARTNER', 'CUSTOMER'] as const).map((type) => (
                    <Button
                      key={type}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api(`/opportunities/${o.id}/won`, {
                              method: 'POST',
                              body: { conversionType: type },
                            }),
                          'Oportunidade ganha: lead convertido.',
                        )
                      }
                    >
                      Ganha ({CONVERSION_TYPE_LABELS[type].toLowerCase()})
                    </Button>
                  ))}
                  <Select
                    aria-label="Motivo da perda"
                    className="h-8 w-auto text-xs"
                    value={lossReasonId}
                    onChange={(e) => setLossReasonId(e.target.value)}
                  >
                    <option value="">Motivo da perda…</option>
                    {lossReasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !lossReasonId}
                    onClick={() =>
                      run(
                        () =>
                          api(`/opportunities/${o.id}/lost`, {
                            method: 'POST',
                            body: { lossReasonId },
                          }),
                        'Oportunidade perdida.',
                      )
                    }
                  >
                    Perdida
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Transferir ao Comercial (MVP M15): checklist de qualificação (SDR-FLOW §8.1). */
function HandoffDialog({
  lead,
  salesOwners,
  onClose,
  onDone,
}: {
  lead: { id: string; displayName: string };
  salesOwners: { id: string; name: string; role: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    salesOwnerId: salesOwners.find((s) => s.role === 'SALES')?.id ?? salesOwners[0]?.id ?? '',
    decisionMaker: '',
    interest: '',
    bestChannelAndTime: '',
    clientCount: '',
    certificateProvider: '',
    objections: '',
    meetingAt: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/leads/${lead.id}/handoff`, {
        method: 'POST',
        body: {
          salesOwnerId: form.salesOwnerId,
          notes: form.notes || null,
          qualification: {
            decisionMaker: form.decisionMaker,
            interest: form.interest,
            bestChannelAndTime: form.bestChannelAndTime,
            clientCount: form.clientCount ? Number(form.clientCount) : null,
            certificateProvider: form.certificateProvider || null,
            objections: form.objections || null,
            meetingAt: form.meetingAt ? fromLocalInput(form.meetingAt) : null,
          },
        },
      });
      onDone('Lead transferido ao Comercial.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível transferir.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        title="Transferir ao Comercial"
        description={`${lead.displayName}: preencha o checklist de qualificação.`}
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Comercial responsável" htmlFor="handoffOwner">
            <Select
              id="handoffOwner"
              value={form.salesOwnerId}
              onChange={(e) => set('salesOwnerId', e.target.value)}
            >
              {salesOwners.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${QUALIFICATION_LABELS.decisionMaker} *`} htmlFor="handoffDecision">
            <Input
              id="handoffDecision"
              value={form.decisionMaker}
              onChange={(e) => set('decisionMaker', e.target.value)}
            />
          </Field>
          <Field label={`${QUALIFICATION_LABELS.interest} *`} htmlFor="handoffInterest">
            <Textarea
              id="handoffInterest"
              rows={2}
              value={form.interest}
              onChange={(e) => set('interest', e.target.value)}
            />
          </Field>
          <Field label={`${QUALIFICATION_LABELS.bestChannelAndTime} *`} htmlFor="handoffChannel">
            <Input
              id="handoffChannel"
              value={form.bestChannelAndTime}
              onChange={(e) => set('bestChannelAndTime', e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={QUALIFICATION_LABELS.clientCount} htmlFor="handoffClients">
              <Input
                id="handoffClients"
                type="number"
                min={0}
                value={form.clientCount}
                onChange={(e) => set('clientCount', e.target.value)}
              />
            </Field>
            <Field label={QUALIFICATION_LABELS.meetingAt} htmlFor="handoffMeeting">
              <Input
                id="handoffMeeting"
                type="datetime-local"
                value={form.meetingAt}
                onChange={(e) => set('meetingAt', e.target.value)}
              />
            </Field>
          </div>
          <Field label={QUALIFICATION_LABELS.certificateProvider} htmlFor="handoffProvider">
            <Input
              id="handoffProvider"
              value={form.certificateProvider}
              onChange={(e) => set('certificateProvider', e.target.value)}
            />
          </Field>
          <Field label={QUALIFICATION_LABELS.objections} htmlFor="handoffObjections">
            <Textarea
              id="handoffObjections"
              rows={2}
              value={form.objections}
              onChange={(e) => set('objections', e.target.value)}
            />
          </Field>
          <Field label="Observações para o comercial" htmlFor="handoffNotes">
            <Textarea
              id="handoffNotes"
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !form.salesOwnerId}>
              Transferir
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
