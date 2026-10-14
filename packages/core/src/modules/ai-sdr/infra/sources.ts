import type { DbTransaction } from '@docline/db';
import { DEFAULT_TIME_ZONE, localDayBounds, localParts, zonedTime } from '../../../shared/calendar';
import { BusinessRuleError, RateLimitError } from '../../../shared/errors';
import type { UseCaseContext } from '../../../shared/use-case';
import { LEAD_TYPE_LABELS } from '../../leads';
import { notify } from '../../notifications';
import { HISTORY_LIMIT, type LeadContextSource } from '../domain/context';
import { AI_RULES_KEY, resolveAiRules, type AiRules } from '../domain/rules';

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  FIRST_CONTACT: 'Primeiro contato',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  FOLLOW_UP_3: 'Follow-up 3',
  INTERESTED_REPLY: 'Resposta a interessado',
  OBJECTION_REPLY: 'Resposta a objeção',
  SCHEDULING: 'Agendamento',
  REACTIVATION: 'Reativação',
  OTHER: 'Outra',
};

/**
 * Lê só os campos da lista branca (docs/AI-SDR.md §5): o ContextBuilder do
 * domínio decide o que vai para a IA a partir daqui.
 */
export async function loadLeadContextSource(
  tx: DbTransaction,
  leadId: string,
): Promise<LeadContextSource> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      displayName: true,
      companyName: true,
      leadType: true,
      cityRaw: true,
      stateUf: true,
      segment: { select: { name: true } },
      stage: { select: { name: true } },
      origins: {
        orderBy: [{ isFirstTouch: 'desc' }, { collectedAt: 'asc' }],
        take: 1,
        select: { referrerName: true, source: { select: { name: true } } },
      },
      people: {
        where: { status: 'ACTIVE' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        select: { fullName: true },
      },
      messages: {
        where: { status: { not: 'CANCELED' }, body: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: {
          direction: true,
          messageType: true,
          body: true,
          sentAt: true,
          receivedAt: true,
          createdAt: true,
        },
      },
    },
  });
  const origin = lead.origins[0];
  return {
    displayName: lead.displayName,
    companyName: lead.companyName,
    leadTypeLabel: LEAD_TYPE_LABELS[lead.leadType],
    segmentName: lead.segment?.name ?? null,
    city: lead.cityRaw,
    uf: lead.stateUf,
    stageName: lead.stage?.name ?? null,
    origin: origin ? { sourceLabel: origin.source.name, referrerName: origin.referrerName } : null,
    contactPersonName: lead.people[0]?.fullName ?? null,
    interactions: lead.messages.map((m) => ({
      direction: m.direction,
      messageTypeLabel: m.messageType ? (MESSAGE_TYPE_LABELS[m.messageType] ?? null) : null,
      at: m.receivedAt ?? m.sentAt ?? m.createdAt,
      body: m.body,
    })),
  };
}

export async function loadAiRules(tx: DbTransaction): Promise<AiRules> {
  const row = await tx.appSetting.findUnique({ where: { key: AI_RULES_KEY } });
  return resolveAiRules(row?.value);
}

/** Fatos aprovados e ativos, em ordem estável (o prompt de sistema fica igual entre pedidos). */
export function loadKnowledge(tx: DbTransaction) {
  return tx.aiKnowledgeItem.findMany({
    where: { active: true },
    orderBy: { key: 'asc' },
    select: { key: true, title: true, content: true, version: true },
  });
}

/** Mensagens recentes enviadas a outros leads (detecção de envio em massa). */
export async function recentOtherMessages(tx: DbTransaction, leadId: string, now: Date) {
  const rows = await tx.message.findMany({
    where: {
      leadId: { not: leadId },
      direction: 'OUTBOUND',
      status: { in: ['PENDING_CONFIRMATION', 'SENT', 'DELIVERED', 'READ'] },
      body: { not: null },
      createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { body: true },
  });
  return rows.map((r) => r.body!);
}

/** Mês no fuso padrão (orçamento e painel de custo): AAAA-MM ou o corrente. */
export function monthRange(now: Date, month?: string): { start: Date; end: Date; label: string } {
  const local = localParts(now, DEFAULT_TIME_ZONE);
  const year = month ? Number(month.slice(0, 4)) : local.year;
  const m = month ? Number(month.slice(5, 7)) : local.month;
  const next = m === 12 ? { year: year + 1, month: 1 } : { year, month: m + 1 };
  return {
    start: zonedTime({ year, month: m, day: 1 }, 0, DEFAULT_TIME_ZONE),
    end: zonedTime({ ...next, day: 1 }, 0, DEFAULT_TIME_ZONE),
    label: `${year}-${String(m).padStart(2, '0')}`,
  };
}

export async function monthSpendUsd(tx: DbTransaction, now: Date): Promise<number> {
  const { start, end } = monthRange(now);
  const sum = await tx.aiGeneration.aggregate({
    where: { createdAt: { gte: start, lt: end } },
    _sum: { costEstimateUsd: true },
  });
  return Number(sum._sum.costEstimateUsd ?? 0);
}

/**
 * Antes de chamar a IA (§9.1 e §15): cota diária da pessoa (no fuso dela) e
 * orçamento do mês. Pedidos que falharam também contam: protegem de repetição.
 */
export async function assertAiAllowance(ctx: UseCaseContext, userId: string | null) {
  const limits = ctx.deps.aiLimits;
  if (userId) {
    const user = await ctx.tx.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const day = localDayBounds(ctx.now, user?.timezone ?? DEFAULT_TIME_ZONE);
    const today = await ctx.tx.aiGeneration.count({
      where: { requestedById: userId, createdAt: { gte: day.start, lt: day.end } },
    });
    if (today >= limits.maxGenerationsPerUserPerDay) {
      throw new RateLimitError(
        `Você chegou ao limite de ${limits.maxGenerationsPerUserPerDay} usos da IA hoje.`,
      );
    }
  }
  if (limits.monthlyBudgetUsd !== null) {
    const spent = await monthSpendUsd(ctx.tx, ctx.now);
    if (spent >= limits.monthlyBudgetUsd) {
      throw new BusinessRuleError(
        'O orçamento mensal da IA acabou. O administrador pode revisar o limite.',
      );
    }
  }
}

/** Avisa os administradores uma vez por mês quando o gasto passa de 80% do orçamento. */
export async function alertBudget(ctx: UseCaseContext, addedUsd: number) {
  const budget = ctx.deps.aiLimits.monthlyBudgetUsd;
  if (budget === null || addedUsd <= 0) return;
  const spent = await monthSpendUsd(ctx.tx, ctx.now);
  if (spent < budget * 0.8 || spent - addedUsd >= budget * 0.8) return;
  const { start, label } = monthRange(ctx.now);
  const admins = await ctx.tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const admin of admins) {
    const already = await ctx.tx.notification.count({
      where: { userId: admin.id, type: 'ai.budget', createdAt: { gte: start } },
    });
    if (already > 0) continue;
    await notify(ctx.tx, {
      userId: admin.id,
      type: 'ai.budget',
      title: `IA: 80% do orçamento de ${label} usado`,
      body: `US$ ${spent.toFixed(2)} de US$ ${budget.toFixed(2)}.`,
      link: '/configuracoes/ia',
    });
  }
}
