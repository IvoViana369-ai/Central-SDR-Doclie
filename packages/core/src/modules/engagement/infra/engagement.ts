import type { DbTransaction, EnrollmentStopReason, Prisma, TaskType } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import { toJson } from '../../../shared/use-case';
import { PRE_CONTACT_STAGE_KEYS } from '../domain/stop-reasons';

/**
 * Estado de contato do lead que vários módulos alteram: inscrição na cadência,
 * tarefas abertas e datas de contato. Só usa o banco (nenhum outro módulo),
 * para que conformidade, leads e pipeline possam chamá-lo sem ciclo.
 */

/** Quem provocou a mudança (pessoa ou automação). */
export type EngagementActor = { kind: 'user'; id: string } | { kind: 'automation' };

/** Pessoa que executa o caso de uso; processos internos contam como automação. */
export function engagementActorOf(actor: Actor): EngagementActor {
  return actor.kind === 'user' ? { kind: 'user', id: actor.id } : { kind: 'automation' };
}

function eventActor(actor: EngagementActor) {
  return actor.kind === 'user'
    ? { actorType: 'USER' as const, actorId: actor.id }
    : { actorType: 'AUTOMATION' as const, actorId: null };
}

/** Inscrição em andamento (ativa ou pausada) do lead, se houver. */
export function findOngoingEnrollment(tx: DbTransaction, leadId: string) {
  return tx.cadenceEnrollment.findFirst({
    where: { leadId, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: {
      cadence: {
        select: {
          id: true,
          name: true,
          stopOnReply: true,
          steps: { orderBy: { position: 'asc' } },
        },
      },
    },
  });
}

/** Vencimento da próxima tarefa aberta (coluna `next_action_at` do lead). */
export async function refreshNextAction(tx: DbTransaction, leadId: string): Promise<void> {
  const next = await tx.task.findFirst({
    where: { leadId, status: 'OPEN' },
    orderBy: { dueAt: 'asc' },
    select: { dueAt: true },
  });
  await tx.lead.update({ where: { id: leadId }, data: { nextActionAt: next?.dueAt ?? null } });
}

/** Cancela tarefas abertas do lead (todas ou só de alguns tipos). */
export async function cancelOpenTasks(
  tx: DbTransaction,
  leadId: string,
  reason: string,
  options: { types?: TaskType[]; enrollmentId?: string } = {},
): Promise<number> {
  const where: Prisma.TaskWhereInput = {
    leadId,
    status: 'OPEN',
    ...(options.types ? { type: { in: options.types } } : {}),
    ...(options.enrollmentId ? { enrollmentId: options.enrollmentId } : {}),
  };
  const { count } = await tx.task.updateMany({
    where,
    data: { status: 'CANCELED', outcome: reason.slice(0, 200) },
  });
  return count;
}

/** Tarefas de abordagem (as que a cadência e o contato assistido geram). */
export const OUTREACH_TASK_TYPES: TaskType[] = ['FIRST_CONTACT', 'FOLLOW_UP', 'CALL'];

/**
 * Encerra a inscrição em andamento do lead e cancela a tarefa do passo atual.
 * Devolve a inscrição encerrada (ou nula, se não havia).
 */
export async function stopLeadEnrollment(
  tx: DbTransaction,
  leadId: string,
  reason: EnrollmentStopReason,
  now: Date,
  actor: EngagementActor = { kind: 'automation' },
) {
  const enrollment = await findOngoingEnrollment(tx, leadId);
  if (!enrollment) return null;
  await tx.cadenceEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: 'STOPPED',
      stopReason: reason,
      endedAt: now,
      nextStepDueAt: null,
      pausedUntil: null,
    },
  });
  await cancelOpenTasks(tx, leadId, 'Cadência encerrada.', { enrollmentId: enrollment.id });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: 'cadence.stopped',
      occurredAt: now,
      ...eventActor(actor),
      subjectType: 'cadence_enrollment',
      subjectId: enrollment.id,
      payload: toJson({ reason, cadence: enrollment.cadence.name }),
    },
  });
  await refreshNextAction(tx, leadId);
  return enrollment;
}

/** Pausa a inscrição ativa (ex.: "fora do escritório") até uma data. */
export async function pauseLeadEnrollment(
  tx: DbTransaction,
  leadId: string,
  until: Date | null,
  now: Date,
  actor: EngagementActor = { kind: 'automation' },
) {
  const enrollment = await findOngoingEnrollment(tx, leadId);
  if (!enrollment || enrollment.status !== 'ACTIVE') return null;
  await tx.cadenceEnrollment.update({
    where: { id: enrollment.id },
    data: { status: 'PAUSED', pausedUntil: until },
  });
  await cancelOpenTasks(tx, leadId, 'Cadência pausada.', { enrollmentId: enrollment.id });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: 'cadence.paused',
      occurredAt: now,
      ...eventActor(actor),
      subjectType: 'cadence_enrollment',
      subjectId: enrollment.id,
      payload: toJson({ until: until?.toISOString() ?? null, cadence: enrollment.cadence.name }),
    },
  });
  await refreshNextAction(tx, leadId);
  return enrollment;
}

/**
 * Mudança manual de etapa (docs/SDR-FLOW.md §3.2, regra 5): sair das etapas da
 * cadência (ou ir para perda) encerra a inscrição. Ficar nas etapas anteriores
 * ao primeiro contato ou nas etapas-alvo dos passos não encerra.
 */
export async function stopEnrollmentOnStageChange(
  tx: DbTransaction,
  leadId: string,
  toStageKey: string,
  now: Date,
  actor: EngagementActor,
) {
  const enrollment = await findOngoingEnrollment(tx, leadId);
  if (!enrollment) return null;
  const cadenceStages = new Set([
    ...PRE_CONTACT_STAGE_KEYS,
    ...enrollment.cadence.steps.flatMap((s) => (s.targetStageKey ? [s.targetStageKey] : [])),
  ]);
  if (cadenceStages.has(toStageKey)) return null;
  return stopLeadEnrollment(tx, leadId, 'STAGE_CHANGED', now, actor);
}

const CHANNEL_CONTACT_TYPES = {
  WHATSAPP: ['PHONE'],
  PHONE: ['PHONE'],
  EMAIL: ['EMAIL'],
  INSTAGRAM: ['INSTAGRAM'],
  ANY: ['PHONE', 'EMAIL', 'INSTAGRAM'],
} as const;

/**
 * Situação de contato mudou (Lista Não Contatar, contato inválido): opt-out e
 * bloqueio encerram a cadência e cancelam as tarefas de abordagem; sem contato
 * ativo para o canal do próximo passo, a cadência também termina.
 */
export async function syncEngagementWithContactState(
  tx: DbTransaction,
  leadId: string,
  contactStatus: string,
  now: Date,
): Promise<void> {
  if (contactStatus === 'OPTED_OUT' || contactStatus === 'BLOCKED') {
    await stopLeadEnrollment(
      tx,
      leadId,
      contactStatus === 'OPTED_OUT' ? 'OPTED_OUT' : 'BLOCKED',
      now,
    );
    const canceled = await cancelOpenTasks(tx, leadId, 'Lead na Lista Não Contatar.', {
      types: OUTREACH_TASK_TYPES,
    });
    if (canceled > 0) await refreshNextAction(tx, leadId);
    return;
  }
  const enrollment = await findOngoingEnrollment(tx, leadId);
  if (!enrollment) return;
  const step =
    enrollment.cadence.steps.find((s) => s.position === enrollment.currentStepPosition) ??
    enrollment.cadence.steps[0];
  if (!step) return;
  const usable = await tx.contactPoint.count({
    where: {
      leadId,
      status: 'ACTIVE',
      type: { in: [...CHANNEL_CONTACT_TYPES[step.channel]] },
    },
  });
  if (usable === 0) await stopLeadEnrollment(tx, leadId, 'CONTACT_INVALID', now);
}

/** Contato de saída feito (mensagem confirmada, ligação atendida, registro manual). */
export async function recordOutboundContact(
  tx: DbTransaction,
  leadId: string,
  at: Date,
): Promise<{ firstContact: boolean }> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { firstContactAt: true, lastContactAt: true, lastActivityAt: true },
  });
  await tx.lead.update({
    where: { id: leadId },
    data: {
      firstContactAt: lead.firstContactAt && lead.firstContactAt < at ? lead.firstContactAt : at,
      lastContactAt: lead.lastContactAt && lead.lastContactAt > at ? lead.lastContactAt : at,
      lastActivityAt: lead.lastActivityAt > at ? lead.lastActivityAt : at,
    },
  });
  return { firstContact: lead.firstContactAt === null };
}

/** Mensagem recebida do lead (resposta colada pelo SDR). */
export async function recordInboundContact(
  tx: DbTransaction,
  leadId: string,
  at: Date,
): Promise<{ firstReply: boolean }> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { firstReplyAt: true, lastInboundAt: true, lastActivityAt: true },
  });
  await tx.lead.update({
    where: { id: leadId },
    data: {
      firstReplyAt: lead.firstReplyAt && lead.firstReplyAt < at ? lead.firstReplyAt : at,
      lastInboundAt: lead.lastInboundAt && lead.lastInboundAt > at ? lead.lastInboundAt : at,
      lastActivityAt: lead.lastActivityAt > at ? lead.lastActivityAt : at,
    },
  });
  return { firstReply: lead.firstReplyAt === null };
}
