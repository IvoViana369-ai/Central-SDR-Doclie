import { createHash } from 'node:crypto';
import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { systemActor } from '../../../shared/actor';
import { ValidationError } from '../../../shared/errors';
import { defineUseCase, type CoreDeps, type UseCaseContext } from '../../../shared/use-case';
import { e164FromWhatsappId } from '../../normalization';
import { notify } from '../../notifications';
import {
  MetaWebhookFormatError,
  parseMetaWebhook,
  webhookContactIds,
  type WhatsappInboundMessageEvent,
  type WhatsappStatusEvent,
} from '../domain/meta-webhook';
import {
  estimateMessageCost,
  resolveWhatsappSettings,
  WHATSAPP_SETTINGS_KEY,
} from '../domain/settings';
import { nextDeliveryStatus } from '../domain/window';
import { attachInbound, inboundBody, matchInbound } from '../infra/inbound';
import { markMessageFailed, markMessageSent } from '../infra/outcome';

/**
 * Webhooks do WhatsApp (F7-02; docs/INTEGRATIONS.md §13), padrão inbox:
 * a rota confere a assinatura e grava o corpo (idempotente pelo SHA-256), o
 * worker processa item a item, cada um na sua transação e idempotente.
 */

export const receiveWhatsappWebhook = defineUseCase({
  name: 'whatsapp.webhook.receive',
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
      events = parseMetaWebhook(payload);
    } catch (error) {
      if (error instanceof MetaWebhookFormatError) {
        throw new ValidationError([{ path: 'body', message: error.message }]);
      }
      throw error;
    }
    const externalEventId = createHash('sha256').update(input.rawBody).digest('hex');
    // HMAC dos telefones citados: a anonimização acha o payload sem guardar o número em claro.
    const contactHashes = webhookContactIds(events).flatMap((waId) => {
      const e164 = e164FromWhatsappId(waId);
      return e164 ? [ctx.deps.identifiers.hash('PHONE', e164)] : [];
    });
    const created = await ctx.tx.webhookEvent.createMany({
      data: [
        {
          provider: input.provider,
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
      where: { provider_externalEventId: { provider: input.provider, externalEventId } },
      select: { id: true },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.whatsappWebhook.name,
      { eventId: row.id },
      { tx: ctx.tx, singletonKey: row.id },
    );
    return { duplicate: false, events: events.length };
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status de uma mensagem enviada (sent, delivered, read, failed) com a cobrança. */
async function applyStatus(
  ctx: UseCaseContext,
  event: WhatsappStatusEvent,
  webhookEventId: string,
) {
  const select = {
    id: true,
    status: true,
    contactPointId: true,
    deliveredAt: true,
    readAt: true,
  } as const;
  let message = await ctx.tx.message.findFirst({
    where: {
      providerMessageId: event.providerMessageId,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
    },
    select,
  });
  // O job pode não ter gravado a resposta da Meta: nosso id volta no status.
  if (!message && event.reference && UUID.test(event.reference)) {
    message = await ctx.tx.message.findFirst({
      where: { id: event.reference, channel: 'WHATSAPP', direction: 'OUTBOUND', mode: 'API' },
      select,
    });
  }
  if (!message) return 'unknown';

  if (event.status === 'FAILED') {
    await markMessageFailed(ctx, message.id, {
      code: event.error?.code ?? 'UNKNOWN',
      failedAt: event.timestamp,
      from: ['QUEUED', 'SENT'],
      webhookEventId,
    });
  } else {
    if (message.status === 'QUEUED' || message.status === 'FAILED') {
      // Saiu: a resposta da API se perdeu ou ainda não foi gravada.
      await markMessageSent(ctx, message.id, {
        providerMessageId: event.providerMessageId,
        sentAt: event.timestamp,
      });
      message = await ctx.tx.message.findUniqueOrThrow({ where: { id: message.id }, select });
    }
    await ctx.tx.messageStatusEvent.upsert({
      where: { messageId_status: { messageId: message.id, status: event.status } },
      create: {
        messageId: message.id,
        status: event.status,
        occurredAt: event.timestamp,
        webhookEventId,
      },
      update: {},
    });
    const next = nextDeliveryStatus(message.status, event.status);
    const reached = event.status === 'DELIVERED' || event.status === 'READ';
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        ...(next ? { status: next } : {}),
        ...(reached && !message.deliveredAt ? { deliveredAt: event.timestamp } : {}),
        ...(event.status === 'READ' && !message.readAt ? { readAt: event.timestamp } : {}),
      },
    });
    // Entregue no WhatsApp: o número usa o WhatsApp.
    if (reached && message.contactPointId) {
      await ctx.tx.contactPoint.updateMany({
        where: { id: message.contactPointId, whatsappStatus: { not: 'CONFIRMED' } },
        data: { whatsappStatus: 'CONFIRMED' },
      });
    }
  }

  if (event.pricing) {
    const settings = await ctx.tx.appSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        pricingCategory: event.pricing.category,
        billable: event.pricing.billable,
        costEstimateUsd: estimateMessageCost(
          event.pricing,
          resolveWhatsappSettings(settings?.value).pricesUsd,
        ),
      },
    });
  }
  return 'status';
}

/** Mensagem recebida: no lead certo, ou na lista de números sem lead. */
async function applyInbound(
  ctx: UseCaseContext,
  event: WhatsappInboundMessageEvent,
  webhook: { id: string; provider: string },
) {
  const duplicate =
    (await ctx.tx.message.count({
      where: { provider: webhook.provider, providerMessageId: event.providerMessageId },
    })) +
    (await ctx.tx.inboundUnmatched.count({
      where: { provider: webhook.provider, providerMessageId: event.providerMessageId },
    }));
  if (duplicate > 0) return 'duplicate';

  const body = inboundBody(event.messageKind, event.text);
  const match = await matchInbound(ctx, event.from);
  if (match.kind === 'matched') {
    await attachInbound(ctx, match, {
      waId: event.from,
      profileName: event.profileName,
      providerMessageId: event.providerMessageId,
      provider: webhook.provider,
      receivedAt: event.timestamp,
      body,
    });
    return 'message';
  }

  await ctx.tx.inboundUnmatched.create({
    data: {
      channel: 'WHATSAPP',
      provider: webhook.provider,
      providerMessageId: event.providerMessageId,
      externalThreadId: event.from,
      phoneE164: match.phoneE164,
      profileName: event.profileName,
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
      type: 'whatsapp.unmatched',
      title:
        match.candidateLeadIds.length > 1
          ? 'Mensagem no WhatsApp de um número que está em mais de um lead'
          : 'Mensagem no WhatsApp de um número sem lead',
      link: '/conversas?aba=sem-lead',
    });
  }
  return 'unmatched';
}

/** Um item do webhook, na sua própria transação. */
const processItem = defineUseCase({
  name: 'whatsapp.webhook.item',
  access: 'lead.update',
  input: z.object({ eventId: z.uuid(), index: z.number().int().nonnegative() }),
  async run(ctx, input) {
    const row = await ctx.tx.webhookEvent.findUniqueOrThrow({
      where: { id: input.eventId },
      select: { id: true, provider: true, payload: true },
    });
    const event = parseMetaWebhook(row.payload)[input.index];
    if (!event) return 'ignored';
    switch (event.type) {
      case 'status':
        return applyStatus(ctx, event, row.id);
      case 'message':
        return applyInbound(ctx, event, row);
      case 'template_status': {
        const status = event.status === 'REINSTATED' ? 'APPROVED' : event.status;
        await ctx.tx.whatsappTemplate.updateMany({
          where: { metaTemplateId: event.metaTemplateId },
          data: { status, rejectedReason: event.reason },
        });
        return 'template';
      }
      case 'template_quality':
        await ctx.tx.whatsappTemplate.updateMany({
          where: { metaTemplateId: event.metaTemplateId },
          data: { qualityScore: event.qualityScore },
        });
        return 'template';
      case 'account':
        // Qualidade, limite ou conta mudaram: a checagem de saúde lê a situação atual.
        await ctx.deps.jobs.enqueue(
          JOBS.whatsappHealthCheck.name,
          {},
          { tx: ctx.tx, singletonKey: 'whatsapp-health' },
        );
        return 'account';
      case 'ignored':
        return 'ignored';
    }
  },
});

/** Job `whatsapp.webhook`: processa a inbox; falha volta para a fila com o erro registrado. */
export async function runWhatsappWebhook(deps: CoreDeps, data: unknown) {
  const { eventId } = z.object({ eventId: z.uuid() }).parse(data);
  const row = await deps.db.webhookEvent.findUnique({
    where: { id: eventId },
    select: { status: true, payload: true },
  });
  if (!row || row.status === 'PROCESSED') return { status: 'skipped' as const };
  const actor = systemActor('whatsapp.webhook');
  const counts: Record<string, number> = {};
  try {
    const total = parseMetaWebhook(row.payload).length;
    for (let index = 0; index < total; index += 1) {
      const kind = await processItem(deps, actor, { eventId, index });
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
  deps.logger.info({ eventId, ...counts }, 'Webhook do WhatsApp processado');
  return { status: 'processed' as const, counts };
}

/** Job `webhooks.purge`: payloads e mensagens de números sem lead com mais de 90 dias (LGPD). */
export async function runWebhooksPurge(deps: CoreDeps) {
  const limit = new Date(deps.clock.now().getTime() - 90 * 86_400_000);
  const [events, unmatched] = await deps.db.$transaction([
    deps.db.webhookEvent.deleteMany({ where: { receivedAt: { lt: limit } } }),
    deps.db.inboundUnmatched.deleteMany({ where: { receivedAt: { lt: limit } } }),
  ]);
  return { webhookEvents: events.count, unmatched: unmatched.count };
}
