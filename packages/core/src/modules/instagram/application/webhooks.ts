import { createHash } from 'node:crypto';
import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { InstagramProviderError, type InstagramUserProfile } from '../../../ports/instagram';
import { JOBS } from '../../../jobs/catalog';
import { systemActor } from '../../../shared/actor';
import { ValidationError } from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type UseCaseContext,
} from '../../../shared/use-case';
import { LEAD_EVENTS } from '../../leads';
import { detectOptOut, recordOutboundSent } from '../../messaging';
import { notify } from '../../notifications';
import { loadContactRules } from '../../settings';
import { describeInstagramError } from '../domain/errors';
import {
  instagramMessageBody,
  instagramWebhookContacts,
  InstagramWebhookFormatError,
  parseInstagramWebhook,
  type InstagramCommentEvent,
  type InstagramMessageEvent,
  type InstagramSeenEvent,
} from '../domain/meta-webhook';
import { instagramConnectionKey } from '../infra/connection';
import { attachInstagramInbound, instagramHandle, matchInstagramInbound } from '../infra/inbound';
import { markInstagramSent } from '../infra/outcome';

/**
 * Webhooks do Instagram (F8-02; docs/INTEGRATIONS.md §7.2), no padrão inbox do
 * WhatsApp: a rota confere a assinatura e grava o corpo (idempotente pelo
 * SHA-256), o worker processa item a item, cada um na sua transação.
 *
 * - Mensagem recebida: vira resposta do lead (para a cadência, opt-out,
 *   classificação) ou fica na lista "sem lead" para uma pessoa decidir.
 * - Eco (o que a conta da Docline enviou): confirma envios da API e registra o
 *   que a equipe respondeu pelo app numa conversa já conhecida.
 * - "Visto": marca como lidas as mensagens enviadas pela API.
 * - Comentário numa publicação da Docline: só de leads já cadastrados (sinal
 *   de interesse, com a resposta privada); de quem não é lead, nada é gravado.
 */

/** Linhas de `webhook_events` do Instagram (separadas das do WhatsApp). */
const webhookProviderKey = instagramConnectionKey;
const providerFromKey = (key: string) => key.replace(/^instagram:/, '');

export const receiveInstagramWebhook = defineUseCase({
  name: 'instagram.webhook.receive',
  access: 'public',
  input: z.object({ provider: z.string().min(1), rawBody: z.string().max(1_000_000) }),
  async run(ctx, input) {
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      throw new ValidationError([{ path: 'body', message: 'JSON inválido.' }]);
    }
    let events;
    try {
      events = parseInstagramWebhook(payload);
    } catch (error) {
      if (error instanceof InstagramWebhookFormatError) {
        throw new ValidationError([{ path: 'body', message: error.message }]);
      }
      throw error;
    }
    const provider = webhookProviderKey(input.provider);
    const externalEventId = createHash('sha256').update(input.rawBody).digest('hex');
    // HMAC dos @ e IGSIDs citados: a anonimização acha o payload sem guardar o valor em claro.
    const contacts = instagramWebhookContacts(events);
    const contactHashes = [
      ...contacts.usernames.flatMap((u) => {
        const handle = instagramHandle(u);
        return handle ? [ctx.deps.identifiers.hash('INSTAGRAM', handle)] : [];
      }),
      ...contacts.userIds.map((id) => ctx.deps.identifiers.hash('INSTAGRAM', `igsid:${id}`)),
    ];
    const created = await ctx.tx.webhookEvent.createMany({
      data: [
        {
          provider,
          externalEventId,
          payload: payload as Prisma.InputJsonValue,
          contactHashes,
          receivedAt: ctx.now,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return { duplicate: true, events: events.length };
    const row = await ctx.tx.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider, externalEventId } },
      select: { id: true },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.instagramWebhook.name,
      { eventId: row.id },
      { tx: ctx.tx, singletonKey: row.id },
    );
    return { duplicate: false, events: events.length };
  },
});

type Webhook = { id: string; provider: string };

/** Webhook de outra conta (um app da Meta pode servir mais de uma). */
function otherAccount(ctx: UseCaseContext, accountId: string | null) {
  const own = ctx.deps.instagram?.accountId;
  return Boolean(own && accountId && accountId !== own);
}

const LIVE_LEAD = { status: { in: ['ACTIVE' as const, 'ARCHIVED' as const] } };

// --- Mensagens recebidas ------------------------------------------------------

async function applyInbound(
  ctx: UseCaseContext,
  event: InstagramMessageEvent,
  webhook: Webhook,
  profile: InstagramUserProfile | null,
) {
  const provider = providerFromKey(webhook.provider);
  const duplicate =
    (await ctx.tx.message.count({
      where: { provider, providerMessageId: event.providerMessageId },
    })) +
    (await ctx.tx.inboundUnmatched.count({
      where: { provider, providerMessageId: event.providerMessageId },
    }));
  if (duplicate > 0) return 'duplicate';

  const known = await ctx.tx.conversation.findFirst({
    where: { channel: 'INSTAGRAM', externalThreadId: event.userId, handle: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { handle: true },
  });
  const handle = instagramHandle(profile?.username) ?? known?.handle ?? null;
  const body = instagramMessageBody(event.messageKind, event.text);
  const match = await matchInstagramInbound(ctx, event.userId, handle);
  if (match.kind === 'matched') {
    await attachInstagramInbound(ctx, match, {
      igsid: event.userId,
      handle,
      name: profile?.name ?? null,
      providerMessageId: event.providerMessageId,
      provider,
      receivedAt: event.timestamp,
      body,
    });
    return 'message';
  }

  await ctx.tx.inboundUnmatched.create({
    data: {
      channel: 'INSTAGRAM',
      provider,
      providerMessageId: event.providerMessageId,
      externalThreadId: event.userId,
      handle,
      profileName: profile?.name ?? null,
      messageKind: event.messageKind,
      body,
      receivedAt: event.timestamp,
      candidateLeadIds: match.candidateLeadIds,
      webhookEventId: webhook.id,
    },
  });
  // Quem distribui leads decide: vincular a um lead ou descartar.
  const people = await ctx.tx.user.findMany({
    where: { role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  for (const person of people) {
    await notify(ctx.tx, {
      userId: person.id,
      type: 'instagram.unmatched',
      title:
        match.candidateLeadIds.length > 1
          ? 'Mensagem no Instagram de um @ que está em mais de um lead'
          : 'Mensagem no Instagram de quem não é lead',
      link: '/conversas?canal=instagram&aba=sem-lead',
    });
  }
  return 'unmatched';
}

// --- Ecos (o que a conta da Docline enviou) ---------------------------------

/** Até quando um eco ainda confirma uma mensagem nossa sem o id da Meta. */
const ECHO_MATCH_HOURS = 48;

async function applyEcho(ctx: UseCaseContext, event: InstagramMessageEvent, webhook: Webhook) {
  const provider = providerFromKey(webhook.provider);
  const existing = await ctx.tx.message.findFirst({
    where: { channel: 'INSTAGRAM', providerMessageId: event.providerMessageId },
    select: { id: true, status: true },
  });
  if (existing) {
    // Enviada pela API: o eco pode chegar antes da resposta da Meta ser gravada.
    if (existing.status === 'QUEUED' || existing.status === 'FAILED') {
      await markInstagramSent(ctx, existing.id, {
        providerMessageId: event.providerMessageId,
        sentAt: event.timestamp,
        recipientId: event.userId,
      });
    }
    return 'echo';
  }

  const since = new Date(event.timestamp.getTime() - ECHO_MATCH_HOURS * 3_600_000);
  const text = event.text?.trim() ?? null;
  if (text) {
    // Envio pela API sem resposta gravada (tentativa caída ou resultado incerto).
    const pending = await ctx.tx.message.findMany({
      where: {
        channel: 'INSTAGRAM',
        mode: 'API',
        direction: 'OUTBOUND',
        providerMessageId: null,
        body: text,
        OR: [
          { status: 'QUEUED', sendAttemptedAt: { gte: since } },
          { status: 'FAILED', failedAt: { gte: since } },
        ],
        AND: [
          {
            OR: [
              { conversation: { externalThreadId: event.userId } },
              { privateReplyFor: { externalUserId: event.userId } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, errorCode: true },
    });
    const sent = pending.find(
      (m) =>
        m.status === 'QUEUED' ||
        describeInstagramError(m.errorCode ?? '').kind === 'UNKNOWN_OUTCOME',
    );
    if (sent) {
      await markInstagramSent(ctx, sent.id, {
        providerMessageId: event.providerMessageId,
        sentAt: event.timestamp,
        recipientId: event.userId,
      });
      return 'echo';
    }
  }

  // Daqui em diante, só conversas que a Docline já conhece (quem escreveu).
  const conversation = await ctx.tx.conversation.findFirst({
    where: { channel: 'INSTAGRAM', externalThreadId: event.userId, lead: LIVE_LEAD },
    orderBy: [{ lastInboundAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    select: { id: true, leadId: true, contactPointId: true, lastOutboundAt: true },
  });
  if (!conversation) return 'ignored';

  if (text) {
    // Contato assistido já confirmado com o mesmo texto: guarda o id da Meta.
    const assisted = await ctx.tx.message.findFirst({
      where: {
        leadId: conversation.leadId,
        channel: 'INSTAGRAM',
        mode: 'ASSISTED',
        direction: 'OUTBOUND',
        providerMessageId: null,
        body: text,
        OR: [
          { status: 'SENT', sentAt: { gte: since } },
          { status: 'PENDING_CONFIRMATION', createdAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true },
    });
    if (assisted?.status === 'SENT') {
      await ctx.tx.message.update({
        where: { id: assisted.id },
        data: { provider, providerMessageId: event.providerMessageId },
      });
      return 'echo';
    }
    // Aguardando a confirmação de quem enviou: a pessoa confirma (não duplica).
    if (assisted) return 'echo';
  }

  // Respondido pelo app, fora do sistema: entra no histórico da conversa.
  const message = await ctx.tx.message.create({
    data: {
      leadId: conversation.leadId,
      contactPointId: conversation.contactPointId,
      conversationId: conversation.id,
      channel: 'INSTAGRAM',
      direction: 'OUTBOUND',
      mode: 'ASSISTED',
      messageType: 'OTHER',
      body: instagramMessageBody(event.messageKind, event.text),
      status: 'SENT',
      sentAt: event.timestamp,
      provider,
      providerMessageId: event.providerMessageId,
    },
    select: { id: true, leadId: true, channel: true, mode: true, messageType: true },
  });
  await ctx.tx.messageStatusEvent.create({
    data: {
      messageId: message.id,
      status: 'SENT',
      occurredAt: event.timestamp,
      webhookEventId: webhook.id,
    },
  });
  if (!conversation.lastOutboundAt || conversation.lastOutboundAt < event.timestamp) {
    await ctx.tx.conversation.update({
      where: { id: conversation.id },
      data: { lastOutboundAt: event.timestamp },
    });
  }
  await recordOutboundSent(ctx, message, event.timestamp, null);
  return 'echo';
}

// --- "Visto" ----------------------------------------------------------------

async function applySeen(ctx: UseCaseContext, event: InstagramSeenEvent, webhook: Webhook) {
  const messages = await ctx.tx.message.findMany({
    where: {
      channel: 'INSTAGRAM',
      mode: 'API',
      direction: 'OUTBOUND',
      status: { in: ['SENT', 'DELIVERED'] },
      sentAt: { lte: event.timestamp },
      conversation: { externalThreadId: event.userId },
    },
    select: { id: true, deliveredAt: true },
  });
  for (const message of messages) {
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        status: 'READ',
        readAt: event.timestamp,
        deliveredAt: message.deliveredAt ?? event.timestamp,
      },
    });
    await ctx.tx.messageStatusEvent.upsert({
      where: { messageId_status: { messageId: message.id, status: 'READ' } },
      create: {
        messageId: message.id,
        status: 'READ',
        occurredAt: event.timestamp,
        webhookEventId: webhook.id,
      },
      update: {},
    });
  }
  return 'seen';
}

// --- Comentários --------------------------------------------------------------

async function applyComment(ctx: UseCaseContext, event: InstagramCommentEvent, webhook: Webhook) {
  // Respostas da própria Docline nos comentários.
  if (event.accountId && event.userId === event.accountId) return 'ignored';
  if (ctx.deps.instagram && event.userId === ctx.deps.instagram.accountId) return 'ignored';
  const provider = providerFromKey(webhook.provider);
  const duplicate = await ctx.tx.socialComment.count({
    where: { provider, externalCommentId: event.commentId },
  });
  if (duplicate > 0) return 'duplicate';

  const handle = instagramHandle(event.username);
  if (!handle) return 'ignored';
  const points = await ctx.tx.contactPoint.findMany({
    where: {
      type: 'INSTAGRAM',
      valueNormalized: handle,
      status: { not: 'REMOVED' },
      lead: LIVE_LEAD,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, leadId: true },
  });
  const leadIds = [...new Set(points.map((p) => p.leadId))];
  // Só de um lead certo: de quem não é lead (ou está em mais de um), nada fica gravado.
  if (leadIds.length !== 1) return 'ignored';

  const lead = await ctx.tx.lead.findUniqueOrThrow({
    where: { id: leadIds[0]! },
    select: { id: true, ownerId: true, displayName: true },
  });
  const comment = await ctx.tx.socialComment.create({
    data: {
      leadId: lead.id,
      contactPointId: points[0]!.id,
      channel: 'INSTAGRAM',
      provider,
      externalCommentId: event.commentId,
      externalUserId: event.userId,
      authorHandle: handle,
      mediaId: event.mediaId,
      mediaProductType: event.mediaProductType,
      parentCommentId: event.parentCommentId,
      body: event.text,
      commentedAt: event.timestamp,
      webhookEventId: webhook.id,
    },
    select: { id: true },
  });
  // Na timeline, sem o texto (dado pessoal fica só no comentário, que a anonimização apaga).
  await ctx.tx.leadEvent.create({
    data: {
      leadId: lead.id,
      type: LEAD_EVENTS.socialComment,
      occurredAt: event.timestamp,
      actorType: 'AUTOMATION',
      subjectType: 'social_comment',
      subjectId: comment.id,
      channel: 'INSTAGRAM',
      payload: toJson({
        mediaProductType: event.mediaProductType,
        reply: event.parentCommentId !== null,
      }),
    },
  });
  if (lead.ownerId) {
    // Comentário público não é resposta à cadência; um pedido de opt-out ali é conferido por uma pessoa.
    const rules = await loadContactRules(ctx.tx);
    const optOut = event.text
      ? detectOptOut(event.text, rules.optOutKeywords).level === 'CERTAIN'
      : false;
    await notify(ctx.tx, {
      userId: lead.ownerId,
      type: 'instagram.comment',
      title: `Comentário no Instagram da Docline: ${lead.displayName}`,
      body: optOut
        ? 'O comentário parece um pedido para não ser contatado: confira e, se for, registre o opt-out.'
        : 'Dá para responder em particular em até 7 dias.',
      leadId: lead.id,
    });
  }
  return 'comment';
}

// --- Processamento ------------------------------------------------------------

const profileSchema = z
  .object({ username: z.string().nullable(), name: z.string().nullable() })
  .nullable();

/** Um item do webhook, na sua própria transação. */
const processItem = defineUseCase({
  name: 'instagram.webhook.item',
  access: 'lead.update',
  input: z.object({
    eventId: z.uuid(),
    index: z.number().int().nonnegative(),
    profile: profileSchema.default(null),
  }),
  async run(ctx, input) {
    const row = await ctx.tx.webhookEvent.findUniqueOrThrow({
      where: { id: input.eventId },
      select: { id: true, provider: true, payload: true },
    });
    const event = parseInstagramWebhook(row.payload)[input.index];
    if (!event) return 'ignored';
    switch (event.type) {
      case 'message':
        if (otherAccount(ctx, event.accountId)) return 'ignored';
        return event.isEcho
          ? applyEcho(ctx, event, row)
          : applyInbound(ctx, event, row, input.profile);
      case 'seen':
        return applySeen(ctx, event, row);
      case 'comment':
        if (otherAccount(ctx, event.accountId)) return 'ignored';
        return applyComment(ctx, event, row);
      case 'ignored':
        return 'ignored';
    }
  },
});

/**
 * @ e nome de quem escreveu pela primeira vez (fora da transação: chamada à
 * Meta). Falha passageira derruba o job (a fila tenta de novo); o resto segue
 * sem perfil e a mensagem fica na lista "sem lead".
 */
async function resolveProfile(deps: CoreDeps, igsid: string): Promise<InstagramUserProfile | null> {
  const known = await deps.db.conversation.count({
    where: { channel: 'INSTAGRAM', externalThreadId: igsid, handle: { not: null } },
  });
  if (known > 0 || !deps.instagram) return null;
  try {
    return await deps.instagram.getUserProfile(igsid);
  } catch (error) {
    if (error instanceof InstagramProviderError && !error.details.retryable) {
      deps.logger.warn({ code: error.details.code }, 'Perfil do Instagram não consultado');
      return null;
    }
    throw error;
  }
}

/** Job `instagram.webhook`: processa a inbox; falha volta para a fila com o erro registrado. */
export async function runInstagramWebhook(deps: CoreDeps, data: unknown) {
  const { eventId } = z.object({ eventId: z.uuid() }).parse(data);
  const row = await deps.db.webhookEvent.findUnique({
    where: { id: eventId },
    select: { status: true, payload: true },
  });
  if (!row || row.status === 'PROCESSED') return { status: 'skipped' as const };
  const actor = systemActor('instagram.webhook');
  const counts: Record<string, number> = {};
  try {
    const events = parseInstagramWebhook(row.payload);
    for (const [index, event] of events.entries()) {
      const profile =
        event.type === 'message' && !event.isEcho ? await resolveProfile(deps, event.userId) : null;
      const kind = await processItem(deps, actor, { eventId, index, profile });
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  } catch (error) {
    await deps.db.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        error: error instanceof Error ? error.name : 'Erro desconhecido',
      },
    });
    throw error;
  }
  await deps.db.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: 'PROCESSED',
      attempts: { increment: 1 },
      processedAt: deps.clock.now(),
      error: null,
    },
  });
  deps.logger.info({ eventId, ...counts }, 'Webhook do Instagram processado');
  return { status: 'processed' as const, counts };
}
