import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { DEFAULT_TIME_ZONE, localDayBounds } from '../../../shared/calendar';
import { ForbiddenError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { PRE_CONTACT_STAGE_KEYS } from '../../engagement';
import { formatLeadCode } from '../../leads';
import { loadContactRules } from '../../settings';
import {
  QUEUE_SECTIONS,
  queuePriority,
  TASK_TYPE_LABELS,
  type QueueSectionKey,
} from '../domain/queue';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Itens lidos por seção (a contagem mostra "N+" acima disso). */
const SCAN_LIMIT = 100;
/** Itens devolvidos por seção, já ordenados por prioridade. */
const SHOW_LIMIT = 30;

const leadCardSelect = {
  id: true,
  code: true,
  displayName: true,
  cityRaw: true,
  stateUf: true,
  score: true,
  scoreBand: true,
  contactStatus: true,
  hasWhatsapp: true,
  hasPhone: true,
  hasInstagram: true,
  lastInboundAt: true,
  lastContactAt: true,
  stage: { select: { key: true, name: true, color: true } },
} satisfies Prisma.LeadSelect;

type LeadCard = Prisma.LeadGetPayload<{ select: typeof leadCardSelect }>;

const taskCardSelect = {
  id: true,
  type: true,
  title: true,
  dueAt: true,
  enrollmentId: true,
  messageType: true,
  channel: true,
  lead: { select: leadCardSelect },
  // Campanha da inscrição e a abordagem sorteada para o lead (Fase 10).
  enrollment: {
    select: {
      campaign: { select: { id: true, name: true } },
      campaignLeads: {
        take: 1,
        select: { variant: { select: { approach: { select: { id: true, name: true } } } } },
      },
    },
  },
} satisfies Prisma.TaskSelect;

function leadView(lead: LeadCard) {
  return { ...lead, codeLabel: formatLeadCode(lead.code) };
}

export interface QueueItem {
  key: string;
  section: QueueSectionKey;
  kind: 'task' | 'lead' | 'message' | 'opportunity';
  priority: number;
  dueAt: Date | null;
  overdue: boolean;
  lead: ReturnType<typeof leadView>;
  task?: {
    id: string;
    type: string;
    typeLabel: string;
    title: string;
    enrollmentId: string | null;
    messageType: string | null;
    channel: string | null;
    /** Campanha que liberou o lead e a abordagem sorteada (quando há). */
    campaign: { id: string; name: string; approach: { id: string; name: string } | null } | null;
  };
  message?: { id: string; channel: string; body: string | null; createdAt: Date };
  opportunity?: { id: string; acceptDueAt: Date; acceptedAt: Date | null; role: 'sdr' | 'sales' };
}

/**
 * Minha Fila SDR (M10; docs/SDR-FLOW.md §5): o que fazer agora, por seção e
 * prioridade. Gestor e ADMIN podem ver a fila de outra pessoa.
 */
export const getMyQueue = defineUseCase({
  name: 'tasks.queue',
  access: 'lead.read',
  input: z.object({ userId: z.uuid().optional() }),
  async run(ctx, input) {
    if (ctx.actor.kind !== 'user') throw new ForbiddenError('A fila é de uma pessoa.');
    const privileged = ctx.actor.role === 'ADMIN' || ctx.actor.role === 'MANAGER';
    const userId = input.userId ?? ctx.actor.id;
    if (userId !== ctx.actor.id && !privileged) {
      throw new ForbiddenError('Só gestor e ADMIN veem a fila de outra pessoa.');
    }
    const now = ctx.now;
    const [rules, user] = await Promise.all([
      loadContactRules(ctx.tx),
      ctx.tx.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    ]);
    const today = localDayBounds(now, user?.timezone ?? DEFAULT_TIME_ZONE);
    const activeLead: Prisma.LeadWhereInput = {
      status: 'ACTIVE',
      contactStatus: { notIn: ['OPTED_OUT', 'BLOCKED'] },
    };
    const openStage: Prisma.LeadWhereInput = { stage: { category: { in: ['OPEN', 'PARKED'] } } };
    // Lead transferido ao Comercial fica em "Oportunidades abertas", não nas seções de prospecção.
    const noOpenOpportunity: Prisma.LeadWhereInput = {
      opportunities: { none: { status: 'OPEN' } },
    };

    const [
      replyCandidates,
      overdueTasks,
      pending,
      todayTasks,
      hot,
      fresh,
      forgotten,
      awaiting,
      opportunities,
    ] = await Promise.all([
      ctx.tx.lead.findMany({
        where: { ownerId: userId, ...activeLead, ...openStage, lastInboundAt: { not: null } },
        orderBy: { lastInboundAt: 'desc' },
        take: SCAN_LIMIT,
        select: {
          ...leadCardSelect,
          tasks: {
            where: { status: 'OPEN', type: { in: ['REPLY_NEEDED', 'MEETING'] } },
            orderBy: { dueAt: 'asc' },
            take: 1,
            select: taskCardSelect,
          },
        },
      }),
      ctx.tx.task.findMany({
        where: {
          assigneeId: userId,
          status: 'OPEN',
          dueAt: { lt: now },
          type: { not: 'REPLY_NEEDED' },
        },
        orderBy: { dueAt: 'asc' },
        take: SCAN_LIMIT,
        select: taskCardSelect,
      }),
      ctx.tx.message.findMany({
        where: { createdById: userId, status: 'PENDING_CONFIRMATION' },
        orderBy: { createdAt: 'asc' },
        take: SCAN_LIMIT,
        select: {
          id: true,
          channel: true,
          body: true,
          createdAt: true,
          lead: { select: leadCardSelect },
        },
      }),
      ctx.tx.task.findMany({
        where: {
          assigneeId: userId,
          status: 'OPEN',
          dueAt: { gte: now, lt: today.end },
          type: { not: 'REPLY_NEEDED' },
        },
        orderBy: { dueAt: 'asc' },
        take: SCAN_LIMIT,
        select: taskCardSelect,
      }),
      ctx.tx.lead.findMany({
        where: {
          ownerId: userId,
          ...activeLead,
          ...noOpenOpportunity,
          // Quentes ainda não trabalhados: antes do primeiro contato.
          stage: { key: { in: PRE_CONTACT_STAGE_KEYS } },
          scoreBand: { in: ['HOT', 'PRIORITY'] },
          firstContactAt: null,
        },
        orderBy: [{ score: 'desc' }, { id: 'asc' }],
        take: SCAN_LIMIT,
        select: leadCardSelect,
      }),
      ctx.tx.lead.findMany({
        where: {
          ownerId: userId,
          ...activeLead,
          assignedAt: { gte: new Date(now.getTime() - rules.newLeadDays * DAY_MS) },
          stage: { key: { in: ['NEW', 'TO_QUALIFY'] } },
        },
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        take: SCAN_LIMIT,
        select: leadCardSelect,
      }),
      ctx.tx.lead.findMany({
        where: {
          ownerId: userId,
          ...activeLead,
          ...noOpenOpportunity,
          stage: { category: 'OPEN' },
          nextActionAt: null,
          lastActivityAt: { lt: new Date(now.getTime() - rules.forgottenAfterDays * DAY_MS) },
        },
        orderBy: { lastActivityAt: 'asc' },
        take: SCAN_LIMIT,
        select: { ...leadCardSelect, lastActivityAt: true },
      }),
      ctx.tx.cadenceEnrollment.findMany({
        where: { status: 'ACTIVE', currentStepPosition: null, lead: { ownerId: userId } },
        orderBy: { nextStepDueAt: 'asc' },
        take: SCAN_LIMIT,
        select: { nextStepDueAt: true, lead: { select: leadCardSelect } },
      }),
      ctx.tx.opportunity.findMany({
        where: { status: 'OPEN', OR: [{ sdrId: userId }, { salesOwnerId: userId }] },
        orderBy: { handoffAt: 'desc' },
        take: SCAN_LIMIT,
        select: {
          id: true,
          sdrId: true,
          salesOwnerId: true,
          acceptDueAt: true,
          acceptedAt: true,
          lead: { select: leadCardSelect },
        },
      }),
    ]);

    const items: QueueItem[] = [];
    const leadsShown = new Set<string>();
    const taskItem = (section: QueueSectionKey, t: (typeof overdueTasks)[number]): QueueItem => ({
      key: `${section}:${t.id}`,
      section,
      kind: 'task',
      priority: queuePriority({ section, score: t.lead.score, dueAt: t.dueAt, now }),
      dueAt: t.dueAt,
      overdue: t.dueAt < now,
      lead: leadView(t.lead),
      task: {
        id: t.id,
        type: t.type,
        typeLabel: TASK_TYPE_LABELS[t.type],
        title: t.title,
        enrollmentId: t.enrollmentId,
        messageType: t.messageType,
        channel: t.channel,
        campaign: t.enrollment?.campaign
          ? {
              ...t.enrollment.campaign,
              approach: t.enrollment.campaignLeads[0]?.variant?.approach ?? null,
            }
          : null,
      },
    });
    const leadItem = (
      section: QueueSectionKey,
      lead: LeadCard,
      dueAt: Date | null = null,
    ): QueueItem => ({
      key: `${section}:${lead.id}`,
      section,
      kind: 'lead',
      priority: queuePriority({ section, score: lead.score, now }),
      dueAt,
      overdue: false,
      lead: leadView(lead),
    });

    // 1. Respostas aguardando ação: o lead escreveu depois do último contato.
    for (const lead of replyCandidates) {
      if (lead.lastContactAt && lead.lastInboundAt! <= lead.lastContactAt) continue;
      const slaAt = new Date(lead.lastInboundAt!.getTime() + rules.replySlaHours * HOUR_MS);
      const task = lead.tasks[0];
      items.push({
        ...(task ? taskItem('REPLIES', task) : leadItem('REPLIES', lead)),
        key: `REPLIES:${lead.id}`,
        priority: queuePriority({ section: 'REPLIES', score: lead.score, now, replyPending: true }),
        dueAt: slaAt,
        overdue: slaAt < now,
        lead: leadView(lead),
      });
      leadsShown.add(lead.id);
    }
    // 2. Tarefas atrasadas; 3. envios a confirmar; 4–5. tarefas de hoje.
    for (const t of overdueTasks) items.push(taskItem('OVERDUE', t));
    for (const m of pending) {
      items.push({
        key: `PENDING_CONFIRMATION:${m.id}`,
        section: 'PENDING_CONFIRMATION',
        kind: 'message',
        priority: queuePriority({ section: 'PENDING_CONFIRMATION', score: m.lead.score, now }),
        dueAt: null,
        overdue: false,
        lead: leadView(m.lead),
        message: { id: m.id, channel: m.channel, body: m.body, createdAt: m.createdAt },
      });
    }
    for (const t of todayTasks) {
      items.push(
        taskItem(t.type === 'FIRST_CONTACT' ? 'TODAY_FIRST_CONTACT' : 'TODAY_FOLLOW_UP', t),
      );
    }
    for (const t of [...overdueTasks, ...todayTasks]) leadsShown.add(t.lead.id);
    // Seções por lead: cada lead aparece uma vez, na primeira seção em que entra.
    const once = (section: QueueSectionKey, lead: LeadCard, dueAt: Date | null = null) => {
      if (leadsShown.has(lead.id)) return;
      leadsShown.add(lead.id);
      items.push(leadItem(section, lead, dueAt));
    };
    for (const lead of hot) once('HOT_LEADS', lead);
    for (const lead of fresh) once('NEW_LEADS', lead);
    for (const lead of forgotten) once('FORGOTTEN', lead);
    for (const e of awaiting) once('AWAITING_REPLY', e.lead, e.nextStepDueAt);
    for (const o of opportunities) {
      const role = o.salesOwnerId === userId ? 'sales' : 'sdr';
      items.push({
        key: `OPEN_OPPORTUNITIES:${o.id}`,
        section: 'OPEN_OPPORTUNITIES',
        kind: 'opportunity',
        priority: queuePriority({ section: 'OPEN_OPPORTUNITIES', score: o.lead.score, now }),
        dueAt: o.acceptedAt ? null : o.acceptDueAt,
        overdue: !o.acceptedAt && o.acceptDueAt < now,
        lead: leadView(o.lead),
        opportunity: { id: o.id, acceptDueAt: o.acceptDueAt, acceptedAt: o.acceptedAt, role },
      });
    }

    const sections = QUEUE_SECTIONS.map((s) => {
      const list = items
        .filter((i) => i.section === s.key)
        .sort(
          (a, b) =>
            b.priority - a.priority || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0),
        );
      return {
        key: s.key,
        label: s.label,
        hint: s.hint,
        count: list.length,
        countCapped: list.length >= SCAN_LIMIT,
        items: list.slice(0, SHOW_LIMIT),
      };
    });
    return { userId, generatedAt: now, sections };
  },
});
