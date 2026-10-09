import { z } from 'zod';
import { defineUseCase } from '../../../shared/use-case';
import { evaluateLeadGate, isWhatsappCandidate } from '../../compliance';
import { leadScopeWhere, requireLeadInScope } from '../../leads';
import { MESSAGE_STATUS_LABELS } from '../../messaging';
import { formatPhone } from '../../normalization';
import { leadWhatsappInput } from '../contracts/schemas';
import { describeWhatsappError } from '../domain/errors';
import { resolveWhatsappSettings, WHATSAPP_SETTINGS_KEY } from '../domain/settings';
import { TEMPLATE_CATEGORY_LABELS, templateStatusLabel } from '../domain/templates';
import { serviceWindow } from '../domain/window';

/** Leituras do WhatsApp pela API para as telas (ficha, Conversas e configuração). */

const RETRY_WAIT_MS = 10 * 60_000;

/** O que a tela oferece numa mensagem que falhou. */
function retryOption(
  message: { status: string; errorCode: string | null; failedAt: Date | null },
  now: Date,
): 'none' | 'allowed' | 'wait' | 'confirm' {
  if (message.status !== 'FAILED') return 'none';
  const { kind } = describeWhatsappError(message.errorCode ?? '');
  if (kind === 'MARKETING_OPT_OUT' || kind === 'SENDS_DISABLED') return 'none';
  if (kind !== 'UNKNOWN_OUTCOME') return 'allowed';
  return message.failedAt && now.getTime() - message.failedAt.getTime() >= RETRY_WAIT_MS
    ? 'confirm'
    : 'wait';
}

/**
 * Seção WhatsApp da ficha do lead (F7-03): números com opt-in e janela, o
 * gate do modo API, a conversa e os modelos liberados.
 */
export const getLeadWhatsapp = defineUseCase({
  name: 'whatsapp.lead',
  access: 'lead.read',
  input: leadWhatsappInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, { id: true, status: true });
    const provider = ctx.deps.whatsapp?.name ?? null;
    const points = await ctx.tx.contactPoint.findMany({
      where: { leadId: lead.id, type: 'PHONE', status: 'ACTIVE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        valueNormalized: true,
        phoneKind: true,
        whatsappStatus: true,
        permissions: {
          where: { channel: 'WHATSAPP' },
          select: {
            optInStatus: true,
            optInMethod: true,
            optInAt: true,
            evidence: true,
            evidenceMessageId: true,
          },
        },
        conversations: {
          where: { channel: 'WHATSAPP' },
          orderBy: { updatedAt: 'desc' },
          select: { serviceWindowExpiresAt: true, lastInboundAt: true, profileName: true },
        },
        messages: {
          where: { channel: 'WHATSAPP', direction: 'INBOUND' },
          orderBy: { receivedAt: 'desc' },
          take: 5,
          select: { id: true, body: true, receivedAt: true },
        },
      },
    });
    const gate = provider
      ? (
          await evaluateLeadGate(ctx.tx, lead.id, { mode: 'API', actor: ctx.actor, now: ctx.now })
        ).channels.find((c) => c.channel === 'WHATSAPP')!
      : null;
    const numbers = points.filter(isWhatsappCandidate).map((p) => {
      const permission = p.permissions[0] ?? null;
      const conversation = p.conversations[0] ?? null;
      return {
        contactPointId: p.id,
        display: formatPhone(p.valueNormalized),
        whatsappStatus: p.whatsappStatus,
        optIn: {
          status: permission?.optInStatus ?? 'NONE',
          method: permission?.optInMethod ?? null,
          at: permission?.optInAt ?? null,
          evidence: permission?.evidence ?? null,
        },
        window: serviceWindow(conversation?.serviceWindowExpiresAt, ctx.now),
        lastInboundAt: conversation?.lastInboundAt ?? null,
        profileName: conversation?.profileName ?? null,
        recentInbound: p.messages.map((m) => ({
          id: m.id,
          excerpt: (m.body ?? '').slice(0, 80),
          receivedAt: m.receivedAt,
        })),
        usable: gate?.usableContactPointIds.includes(p.id) ?? false,
      };
    });
    const messages = await ctx.tx.message.findMany({
      where: { leadId: lead.id, channel: 'WHATSAPP', mode: 'API' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        direction: true,
        status: true,
        body: true,
        contactPointId: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
        receivedAt: true,
        failedAt: true,
        errorCode: true,
        errorDetail: true,
        classification: true,
        whatsappTemplate: { select: { name: true } },
        sentBy: { select: { name: true } },
      },
    });
    const templates = provider
      ? await ctx.tx.whatsappTemplate.findMany({
          where: { status: 'APPROVED', supported: true, active: true, removedAt: null },
          orderBy: [{ name: 'asc' }, { language: 'asc' }],
          select: {
            id: true,
            name: true,
            language: true,
            category: true,
            bodyText: true,
            bodyParameters: true,
            approach: { select: { name: true } },
          },
        })
      : [];
    return {
      provider,
      leadActive: lead.status === 'ACTIVE',
      gate: gate ? { allowed: gate.allowed, reasons: gate.reasons } : null,
      numbers,
      messages: messages.reverse().map((m) => ({
        ...m,
        statusLabel: MESSAGE_STATUS_LABELS[m.status],
        templateName: m.whatsappTemplate?.name ?? null,
        retry: retryOption(m, ctx.now),
      })),
      templates: templates.map((t) => ({
        ...t,
        categoryLabel: TEMPLATE_CATEGORY_LABELS[t.category],
        approachName: t.approach?.name ?? null,
      })),
    };
  },
});

/**
 * Tela Conversas (F7-03): conversas do WhatsApp dos leads no escopo, das que
 * esperam resposta para as demais.
 */
export const listConversations = defineUseCase({
  name: 'whatsapp.conversations',
  access: 'lead.read',
  input: z.object({ filter: z.enum(['attention', 'open', 'all']).default('attention') }),
  async run(ctx, input) {
    const scope = await leadScopeWhere(ctx.tx, ctx.actor);
    const rows = await ctx.tx.conversation.findMany({
      where: {
        channel: 'WHATSAPP',
        lastInboundAt: { not: null },
        lead: { ...scope, status: { in: ['ACTIVE', 'ARCHIVED'] } },
        ...(input.filter === 'open' ? { serviceWindowExpiresAt: { gt: ctx.now } } : {}),
      },
      orderBy: { lastInboundAt: 'desc' },
      take: 200,
      select: {
        id: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        serviceWindowExpiresAt: true,
        profileName: true,
        contactPoint: { select: { valueNormalized: true } },
        lead: {
          select: {
            id: true,
            code: true,
            displayName: true,
            owner: { select: { id: true, name: true } },
          },
        },
      },
    });
    const list = rows.map((r) => ({
      id: r.id,
      lead: r.lead,
      number: r.contactPoint ? formatPhone(r.contactPoint.valueNormalized) : null,
      profileName: r.profileName,
      lastInboundAt: r.lastInboundAt,
      lastOutboundAt: r.lastOutboundAt,
      window: serviceWindow(r.serviceWindowExpiresAt, ctx.now),
      awaitingReply:
        r.lastInboundAt !== null &&
        (r.lastOutboundAt === null || r.lastInboundAt > r.lastOutboundAt),
    }));
    return input.filter === 'attention' ? list.filter((c) => c.awaitingReply) : list;
  },
});

/** Modelos da conta (configuração). */
export const listWhatsappTemplates = defineUseCase({
  name: 'whatsapp.templates',
  access: 'settings.manage',
  input: z.object({}),
  async run(ctx) {
    const rows = await ctx.tx.whatsappTemplate.findMany({
      orderBy: [{ removedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        qualityScore: true,
        rejectedReason: true,
        bodyText: true,
        bodyParameters: true,
        supported: true,
        unsupportedReason: true,
        active: true,
        removedAt: true,
        lastSyncedAt: true,
        approachId: true,
      },
    });
    return rows.map((t) => ({
      ...t,
      categoryLabel: TEMPLATE_CATEGORY_LABELS[t.category],
      statusLabel: templateStatusLabel(t.status),
    }));
  },
});

/**
 * Situação do WhatsApp pela API no mês (F7-08): conexão e qualidade do número,
 * envios por categoria, entrega, leitura, falhas e custo estimado.
 */
export const getWhatsappOverview = defineUseCase({
  name: 'whatsapp.overview',
  access: 'integration.manage',
  input: z.object({}),
  async run(ctx) {
    const provider = ctx.deps.whatsapp?.name ?? null;
    const monthStart = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
    const [connection, settingsRow, pendingUnmatched, sent, failures] = await Promise.all([
      provider ? ctx.tx.integrationConnection.findUnique({ where: { provider } }) : null,
      ctx.tx.appSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } }),
      ctx.tx.inboundUnmatched.count({ where: { status: 'PENDING' } }),
      ctx.tx.message.findMany({
        where: {
          channel: 'WHATSAPP',
          mode: 'API',
          direction: 'OUTBOUND',
          createdAt: { gte: monthStart },
        },
        select: {
          status: true,
          deliveredAt: true,
          readAt: true,
          pricingCategory: true,
          costEstimateUsd: true,
          whatsappTemplateId: true,
        },
      }),
      ctx.tx.message.groupBy({
        by: ['errorCode'],
        where: {
          channel: 'WHATSAPP',
          mode: 'API',
          status: 'FAILED',
          createdAt: { gte: monthStart },
        },
        _count: { _all: true },
        orderBy: { _count: { errorCode: 'desc' } },
        take: 5,
      }),
    ]);
    const accepted = sent.filter((m) => m.status !== 'QUEUED' && m.status !== 'FAILED');
    const byCategory = new Map<string, { count: number; costUsd: number }>();
    for (const m of sent) {
      const key = m.pricingCategory ?? (m.whatsappTemplateId ? 'sem informação' : 'service');
      const entry = byCategory.get(key) ?? { count: 0, costUsd: 0 };
      entry.count += 1;
      entry.costUsd += Number(m.costEstimateUsd ?? 0);
      byCategory.set(key, entry);
    }
    return {
      provider,
      month: monthStart.toISOString().slice(0, 7),
      connection,
      settings: resolveWhatsappSettings(settingsRow?.value),
      pendingUnmatched,
      totals: {
        requested: sent.length,
        accepted: accepted.length,
        delivered: sent.filter((m) => m.deliveredAt).length,
        read: sent.filter((m) => m.readAt).length,
        failed: sent.filter((m) => m.status === 'FAILED').length,
        costUsd: sent.reduce((sum, m) => sum + Number(m.costEstimateUsd ?? 0), 0),
      },
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
      failures: failures.map((f) => ({
        code: f.errorCode ?? 'desconhecido',
        count: f._count._all,
        message: describeWhatsappError(f.errorCode ?? '').message,
      })),
    };
  },
});
