import { z } from 'zod';
import { defineUseCase } from '../../../shared/use-case';
import { evaluateLeadGate } from '../../compliance';
import { leadScopeWhere, requireLeadInScope } from '../../leads';
import { MESSAGE_STATUS_LABELS } from '../../messaging';
import { leadInstagramInput } from '../contracts/schemas';
import { describeInstagramError } from '../domain/errors';
import { INSTAGRAM_SETTINGS_KEY, resolveInstagramSettings } from '../domain/settings';
import { messagingWindow, privateReplyDeadline, privateReplyState } from '../domain/window';
import { instagramConnectionKey } from '../infra/connection';

/** Leituras do Instagram pela API para as telas (ficha, Conversas e configuração). */

const RETRY_WAIT_MS = 10 * 60_000;

/** O que a tela oferece numa mensagem que falhou. */
function retryOption(
  message: { status: string; errorCode: string | null; failedAt: Date | null },
  now: Date,
): 'none' | 'allowed' | 'wait' | 'confirm' {
  if (message.status !== 'FAILED') return 'none';
  const { kind } = describeInstagramError(message.errorCode ?? '');
  if (kind === 'REPLY_NOT_ALLOWED' || kind === 'SENDS_DISABLED') return 'none';
  if (kind !== 'UNKNOWN_OUTCOME') return 'allowed';
  return message.failedAt && now.getTime() - message.failedAt.getTime() >= RETRY_WAIT_MS
    ? 'confirm'
    : 'wait';
}

/**
 * Seção Instagram da ficha do lead: os @ com as métricas públicas, a conversa
 * com a janela de 24 h, o gate do modo API, as mensagens e os comentários.
 */
export const getLeadInstagram = defineUseCase({
  name: 'instagram.lead',
  access: 'lead.read',
  input: leadInstagramInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, { id: true, status: true });
    const provider = ctx.deps.instagram?.name ?? null;
    const points = await ctx.tx.contactPoint.findMany({
      where: { leadId: lead.id, type: 'INSTAGRAM', status: 'ACTIVE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        valueNormalized: true,
        instagramProfile: {
          select: {
            handle: true,
            status: true,
            followersCount: true,
            mediaCount: true,
            lastPostAt: true,
            checkedAt: true,
          },
        },
        conversations: {
          where: { channel: 'INSTAGRAM' },
          orderBy: { updatedAt: 'desc' },
          select: { serviceWindowExpiresAt: true, lastInboundAt: true, profileName: true },
        },
      },
    });
    const gate = provider
      ? (
          await evaluateLeadGate(ctx.tx, lead.id, { mode: 'API', actor: ctx.actor, now: ctx.now })
        ).channels.find((c) => c.channel === 'INSTAGRAM')!
      : null;
    const profiles = points.map((p) => {
      const conversation = p.conversations[0] ?? null;
      // Métricas de um @ antigo (o lead trocou o @) não valem.
      const metrics =
        p.instagramProfile && p.instagramProfile.handle === p.valueNormalized
          ? p.instagramProfile
          : null;
      return {
        contactPointId: p.id,
        handle: p.valueNormalized,
        profileUrl: `https://www.instagram.com/${encodeURIComponent(p.valueNormalized)}/`,
        metrics: metrics
          ? {
              status: metrics.status,
              followersCount: metrics.followersCount,
              mediaCount: metrics.mediaCount,
              lastPostAt: metrics.lastPostAt,
              checkedAt: metrics.checkedAt,
            }
          : null,
        window: messagingWindow(conversation?.serviceWindowExpiresAt, ctx.now),
        lastInboundAt: conversation?.lastInboundAt ?? null,
        profileName: conversation?.profileName ?? null,
        usable: gate?.usableContactPointIds.includes(p.id) ?? false,
      };
    });
    const messages = await ctx.tx.message.findMany({
      where: {
        leadId: lead.id,
        channel: 'INSTAGRAM',
        OR: [{ conversationId: { not: null } }, { mode: 'API' }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        direction: true,
        mode: true,
        status: true,
        body: true,
        contactPointId: true,
        createdAt: true,
        sentAt: true,
        readAt: true,
        receivedAt: true,
        failedAt: true,
        errorCode: true,
        errorDetail: true,
        classification: true,
        sentBy: { select: { name: true } },
        privateReplyFor: { select: { id: true } },
      },
    });
    const comments = await ctx.tx.socialComment.findMany({
      where: { leadId: lead.id },
      orderBy: { commentedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        authorHandle: true,
        mediaId: true,
        mediaProductType: true,
        parentCommentId: true,
        body: true,
        commentedAt: true,
        privateReplyMessageId: true,
        privateReplyMessage: { select: { status: true, body: true, sentAt: true } },
      },
    });
    return {
      provider,
      leadActive: lead.status === 'ACTIVE',
      gate: gate ? { allowed: gate.allowed, reasons: gate.reasons } : null,
      profiles,
      messages: messages.reverse().map(({ privateReplyFor, ...m }) => ({
        ...m,
        privateReply: privateReplyFor !== null,
        statusLabel: MESSAGE_STATUS_LABELS[m.status],
        retry: m.mode === 'API' ? retryOption(m, ctx.now) : 'none',
      })),
      comments: comments.map((c) => ({
        id: c.id,
        authorHandle: c.authorHandle,
        mediaId: c.mediaId,
        mediaProductType: c.mediaProductType,
        isReply: c.parentCommentId !== null,
        body: c.body,
        commentedAt: c.commentedAt,
        privateReply: {
          state: privateReplyState(c, ctx.now),
          deadline: privateReplyDeadline(c.commentedAt),
          status: c.privateReplyMessage?.status ?? null,
          statusLabel: c.privateReplyMessage
            ? MESSAGE_STATUS_LABELS[c.privateReplyMessage.status]
            : null,
          body: c.privateReplyMessage?.body ?? null,
          sentAt: c.privateReplyMessage?.sentAt ?? null,
        },
      })),
    };
  },
});

/**
 * Tela Conversas, aba Instagram: conversas dos leads no escopo, das que
 * esperam resposta para as demais.
 */
export const listInstagramConversations = defineUseCase({
  name: 'instagram.conversations',
  access: 'lead.read',
  input: z.object({ filter: z.enum(['attention', 'open', 'all']).default('attention') }),
  async run(ctx, input) {
    const scope = await leadScopeWhere(ctx.tx, ctx.actor);
    const rows = await ctx.tx.conversation.findMany({
      where: {
        channel: 'INSTAGRAM',
        lastInboundAt: { not: null },
        lead: { ...scope, status: { in: ['ACTIVE', 'ARCHIVED'] } },
        ...(input.filter === 'open' ? { serviceWindowExpiresAt: { gt: ctx.now } } : {}),
      },
      orderBy: { lastInboundAt: 'desc' },
      take: 200,
      select: {
        id: true,
        handle: true,
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
      handle: r.handle ?? r.contactPoint?.valueNormalized ?? null,
      profileName: r.profileName,
      lastInboundAt: r.lastInboundAt,
      lastOutboundAt: r.lastOutboundAt,
      window: messagingWindow(r.serviceWindowExpiresAt, ctx.now),
      awaitingReply:
        r.lastInboundAt !== null &&
        (r.lastOutboundAt === null || r.lastInboundAt > r.lastOutboundAt),
    }));
    return input.filter === 'attention' ? list.filter((c) => c.awaitingReply) : list;
  },
});

/**
 * Situação do Instagram pela API no mês: conta conectada, respostas enviadas,
 * leitura, falhas, comentários de leads e mensagens de quem não é lead.
 */
export const getInstagramOverview = defineUseCase({
  name: 'instagram.overview',
  access: 'integration.manage',
  input: z.object({}),
  async run(ctx) {
    const provider = ctx.deps.instagram?.name ?? null;
    const monthStart = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
    const [
      connection,
      settingsRow,
      pendingUnmatched,
      sent,
      received,
      comments,
      failures,
      profiles,
    ] = await Promise.all([
      provider
        ? ctx.tx.integrationConnection.findUnique({
            where: { provider: instagramConnectionKey(provider) },
          })
        : null,
      ctx.tx.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } }),
      ctx.tx.inboundUnmatched.count({ where: { channel: 'INSTAGRAM', status: 'PENDING' } }),
      ctx.tx.message.findMany({
        where: {
          channel: 'INSTAGRAM',
          mode: 'API',
          direction: 'OUTBOUND',
          createdAt: { gte: monthStart },
        },
        select: { status: true, readAt: true },
      }),
      ctx.tx.message.count({
        where: { channel: 'INSTAGRAM', direction: 'INBOUND', receivedAt: { gte: monthStart } },
      }),
      ctx.tx.socialComment.count({ where: { commentedAt: { gte: monthStart } } }),
      ctx.tx.message.groupBy({
        by: ['errorCode'],
        where: {
          channel: 'INSTAGRAM',
          mode: 'API',
          status: 'FAILED',
          createdAt: { gte: monthStart },
        },
        _count: { _all: true },
        orderBy: { _count: { errorCode: 'desc' } },
        take: 5,
      }),
      // Consulta de perfis (F8-04): situação dos @ consultados.
      ctx.tx.instagramProfile.groupBy({
        by: ['status'],
        _count: { _all: true },
        _max: { checkedAt: true },
      }),
    ]);
    return {
      provider,
      month: monthStart.toISOString().slice(0, 7),
      connection,
      settings: resolveInstagramSettings(settingsRow?.value),
      pendingUnmatched,
      totals: {
        requested: sent.length,
        accepted: sent.filter((m) => m.status !== 'QUEUED' && m.status !== 'FAILED').length,
        read: sent.filter((m) => m.readAt).length,
        failed: sent.filter((m) => m.status === 'FAILED').length,
        received,
        comments,
      },
      discovery: {
        found: profiles.find((p) => p.status === 'FOUND')?._count._all ?? 0,
        notFound: profiles.find((p) => p.status === 'NOT_FOUND')?._count._all ?? 0,
        errors: profiles.find((p) => p.status === 'ERROR')?._count._all ?? 0,
        lastCheckAt:
          profiles
            .map((p) => p._max.checkedAt)
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      },
      failures: failures.map((f) => ({
        code: f.errorCode ?? 'desconhecido',
        count: f._count._all,
        message: describeInstagramError(f.errorCode ?? '').message,
      })),
    };
  },
});
