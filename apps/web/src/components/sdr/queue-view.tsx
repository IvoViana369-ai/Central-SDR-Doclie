'use client';

import { CHANNEL_LABELS } from '@docline/core/messaging-domain';
import { AtSign, Check, MessageCircle, Phone, RefreshCw, Send, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { PageHeader } from '@/components/page-header';
import { ScoreBadge, StageDot, type ScoreBand } from '@/components/pipeline/pipeline-ui';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';
import { ContactDialog } from './contact-dialog';
import { LogContactDialog, ReplyDialog, RescheduleDialog } from './record-dialogs';
import { isContactTask, type TaskRef } from './shared';

export interface QueueItemView {
  key: string;
  section: string;
  kind: 'task' | 'lead' | 'message' | 'opportunity';
  dueAt: string | Date | null;
  overdue: boolean;
  lead: {
    id: string;
    codeLabel: string;
    displayName: string;
    cityRaw: string | null;
    stateUf: string | null;
    score: number | null;
    scoreBand: ScoreBand | null;
    hasWhatsapp: boolean;
    hasPhone: boolean;
    hasInstagram: boolean;
    stage: { key: string; name: string; color: string } | null;
  };
  task?: TaskRef & { typeLabel: string };
  message?: { id: string; channel: string; body: string | null; createdAt: string | Date };
  opportunity?: {
    id: string;
    acceptDueAt: string | Date;
    acceptedAt: string | Date | null;
    role: 'sdr' | 'sales';
  };
}

export interface QueueData {
  userId: string;
  generatedAt: string | Date;
  sections: {
    key: string;
    label: string;
    hint: string;
    count: number;
    countCapped: boolean;
    items: QueueItemView[];
  }[];
}

type LeadRef = { id: string; displayName: string };
type DialogState =
  | { kind: 'contact'; lead: LeadRef; task?: TaskRef | null }
  | { kind: 'log'; lead: LeadRef; task?: TaskRef | null }
  | { kind: 'reply'; lead: LeadRef }
  | { kind: 'reschedule'; task: { id: string; title: string; dueAt: string | Date } }
  | null;

/** Quando vence ou o prazo de cada item, do jeito que importa na seção. */
function dueText(item: QueueItemView): string | null {
  if (!item.dueAt) return null;
  const when = formatDateTime(item.dueAt);
  switch (item.section) {
    case 'REPLIES':
      return item.overdue ? `Prazo de resposta passou (${when})` : `Responder até ${when}`;
    case 'AWAITING_REPLY':
      return `"Sem resposta" em ${when}`;
    case 'OPEN_OPPORTUNITIES':
      return item.overdue ? `Aceite atrasado (${when})` : `Aceite até ${when}`;
    default:
      return item.overdue ? `Atrasada desde ${when}` : `Vence ${when}`;
  }
}

/**
 * Minha Fila (MVP M10; docs/SDR-FLOW.md §5): o que fazer agora, por seção e
 * prioridade, com as ações mais comuns no próprio item.
 */
export function QueueView({
  queue,
  self,
  users,
  optOutKeywords,
  canAct,
}: {
  queue: QueueData;
  self: { id: string; name: string };
  /** Gestor e ADMIN: pessoas cuja fila podem ver. */
  users: { id: string; name: string }[] | null;
  optOutKeywords: string[];
  canAct: boolean;
}) {
  const router = useRouter();
  const { run, notice, busy } = useAction();
  const [dialog, setDialog] = useState<DialogState>(null);
  const own = queue.userId === self.id;
  const actions = own && canAct;
  const total = queue.sections.reduce((sum, s) => sum + s.count, 0);
  const done = (message: string) => {
    setDialog(null);
    void run(async () => null, message);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Minha Fila"
        description={`Atualizada em ${formatDateTime(queue.generatedAt)}. Prioridade: respostas, atrasados, envios a confirmar e o que vence hoje.`}
        actions={
          <>
            {users ? (
              <Select
                aria-label="Fila de"
                className="w-auto"
                value={queue.userId}
                onChange={(e) =>
                  router.push(
                    e.target.value === self.id ? '/fila' : `/fila?userId=${e.target.value}`,
                  )
                }
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === self.id ? `${u.name} (eu)` : u.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {actions ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api<{ claimed: string[] }>('/leads/pull', {
                        method: 'POST',
                        body: { count: 5 },
                      }),
                    (r) =>
                      r.claimed.length > 0
                        ? `${r.claimed.length} lead(s) puxado(s) do pool para você.`
                        : 'Nenhum lead disponível no pool do seu território.',
                  )
                }
              >
                <UserPlus /> Puxar leads do pool
              </Button>
            ) : null}
            <Button
              variant="ghost"
              aria-label="Atualizar a fila"
              disabled={busy}
              onClick={() => router.refresh()}
            >
              <RefreshCw />
            </Button>
          </>
        }
      />

      {!own ? (
        <Alert title="Fila de outra pessoa">
          Somente consulta: as ações ficam com a pessoa responsável pelos leads.
        </Alert>
      ) : null}
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      <nav aria-label="Seções da fila" className="flex flex-wrap gap-2">
        {queue.sections.map((s) => (
          <a
            key={s.key}
            href={`#${s.key}`}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              s.count === 0 ? 'text-muted-foreground' : 'font-medium hover:bg-accent',
            )}
          >
            {s.label}{' '}
            <span className="tabular-nums">
              {s.count}
              {s.countCapped ? '+' : ''}
            </span>
          </a>
        ))}
      </nav>

      {total === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nada pendente agora.{' '}
            {actions ? 'Puxe leads do pool ou confira o pipeline.' : 'Confira o pipeline.'}
          </CardContent>
        </Card>
      ) : null}

      {queue.sections
        .filter((s) => s.count > 0)
        .map((s) => (
          <Card key={s.key} id={s.key} data-testid={`queue-${s.key}`}>
            <CardHeader>
              <CardTitle>
                {s.label}{' '}
                <span className="text-muted-foreground tabular-nums">
                  ({s.count}
                  {s.countCapped ? '+' : ''})
                </span>
              </CardTitle>
              <CardDescription>{s.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y" aria-label={s.label}>
                {s.items.map((item) => (
                  <QueueRow
                    key={item.key}
                    item={item}
                    actions={actions}
                    busy={busy}
                    run={run}
                    open={setDialog}
                  />
                ))}
              </ul>
              {s.count > s.items.length ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  Mostrando os {s.items.length} mais prioritários.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}

      {dialog?.kind === 'contact' ? (
        <ContactDialog
          lead={dialog.lead}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'log' ? (
        <LogContactDialog
          lead={dialog.lead}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'reply' ? (
        <ReplyDialog
          lead={dialog.lead}
          optOutKeywords={optOutKeywords}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'reschedule' ? (
        <RescheduleDialog task={dialog.task} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </div>
  );
}

type Run = ReturnType<typeof useAction>['run'];

function QueueRow({
  item,
  actions,
  busy,
  run,
  open,
}: {
  item: QueueItemView;
  actions: boolean;
  busy: boolean;
  run: Run;
  open: (dialog: DialogState) => void;
}) {
  const { lead, task, message, opportunity } = item;
  const ref = { id: lead.id, displayName: lead.displayName };
  const due = dueText(item);

  return (
    <li className="space-y-1.5 py-3 first:pt-0" data-testid="queue-item">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
          {lead.displayName}
        </Link>
        <span className="text-xs text-muted-foreground">
          {lead.codeLabel}
          {lead.cityRaw ? ` · ${lead.cityRaw}/${lead.stateUf}` : ''}
        </span>
        <ScoreBadge score={lead.score} band={lead.scoreBand} />
        {lead.stage ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <StageDot color={lead.stage.color} /> {lead.stage.name}
          </span>
        ) : null}
        <span className="flex gap-1 text-muted-foreground" aria-hidden>
          {lead.hasWhatsapp ? <MessageCircle className="size-3.5" /> : null}
          {lead.hasPhone ? <Phone className="size-3.5" /> : null}
          {lead.hasInstagram ? <AtSign className="size-3.5" /> : null}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {task ? (
          <>
            <span>{task.title}</span>
            <Badge variant="muted">{task.typeLabel}</Badge>
            {task.campaign ? (
              <Badge title="Lead liberado por uma campanha">
                Campanha: {task.campaign.name}
                {task.campaign.approach ? ` · abordagem ${task.campaign.approach.name}` : ''}
              </Badge>
            ) : null}
          </>
        ) : null}
        {message ? (
          <span className="text-muted-foreground">
            {CHANNEL_LABELS[message.channel] ?? message.channel} preparado em{' '}
            {formatDateTime(message.createdAt)}
            {message.body
              ? ` · “${message.body.slice(0, 80)}${message.body.length > 80 ? '…' : ''}”`
              : ''}
          </span>
        ) : null}
        {opportunity ? (
          <Badge variant={opportunity.acceptedAt ? 'success' : 'warning'}>
            {opportunity.acceptedAt ? 'Aceita pelo Comercial' : 'Aguardando aceite'}
            {opportunity.role === 'sales' ? ' · você é o comercial' : ''}
          </Badge>
        ) : null}
        {due ? (
          <span className={item.overdue ? 'text-destructive' : 'text-muted-foreground'}>{due}</span>
        ) : null}
      </p>
      {actions ? (
        <div className="flex flex-wrap gap-1.5">
          {task ? (
            <>
              {isContactTask(task) ? (
                <Button size="sm" onClick={() => open({ kind: 'contact', lead: ref, task })}>
                  <Send /> {task.type === 'REPLY_NEEDED' ? 'Responder' : 'Contatar'}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => open({ kind: 'log', lead: ref, task })}
              >
                Registrar contato
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/tasks/${task.id}/complete`, { method: 'POST', body: {} }),
                    'Tarefa concluída.',
                  )
                }
              >
                <Check /> Concluir
              </Button>
              {item.dueAt && item.section !== 'REPLIES' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    open({
                      kind: 'reschedule',
                      task: { id: task.id, title: task.title, dueAt: item.dueAt! },
                    })
                  }
                >
                  Reagendar
                </Button>
              ) : null}
              {task.enrollmentId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api(`/tasks/${task.id}/skip`, { method: 'POST', body: {} }),
                      'Passo pulado: a cadência seguiu para o próximo.',
                    )
                  }
                >
                  Pular passo
                </Button>
              ) : null}
            </>
          ) : null}
          {item.kind === 'lead' && item.section === 'REPLIES' ? (
            <Button size="sm" onClick={() => open({ kind: 'contact', lead: ref })}>
              <Send /> Responder
            </Button>
          ) : null}
          {item.kind === 'lead' &&
          ['HOT_LEADS', 'NEW_LEADS', 'FORGOTTEN'].includes(item.section) ? (
            <>
              <Button size="sm" onClick={() => open({ kind: 'contact', lead: ref })}>
                <Send /> Contatar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/leads/${lead.id}/cadence`, { method: 'POST', body: {} }),
                    'Lead inscrito na cadência padrão.',
                  )
                }
              >
                Inscrever na cadência
              </Button>
            </>
          ) : null}
          {item.section === 'AWAITING_REPLY' ? (
            <Button size="sm" variant="outline" onClick={() => open({ kind: 'reply', lead: ref })}>
              Registrar resposta
            </Button>
          ) : null}
          {message ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/messages/${message.id}/confirm`, { method: 'POST', body: {} }),
                    'Envio confirmado.',
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
                  run(
                    () => api(`/messages/${message.id}/cancel`, { method: 'POST', body: {} }),
                    'Envio cancelado.',
                  )
                }
              >
                Não enviei
              </Button>
            </>
          ) : null}
          {opportunity && opportunity.role === 'sales' && !opportunity.acceptedAt ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    api(`/opportunities/${opportunity.id}/accept`, { method: 'POST', body: {} }),
                  'Oportunidade aceita.',
                )
              }
            >
              Aceitar oportunidade
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
