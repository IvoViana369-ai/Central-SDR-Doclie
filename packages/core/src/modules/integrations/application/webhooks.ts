import { newId, type Prisma } from '@docline/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { JOBS } from '../../../jobs/catalog';
import {
  createWebhookEndpointInput,
  listWebhookDeliveriesInput,
  setWebhookEndpointStatusInput,
  updateWebhookEndpointInput,
  webhookDeliveryIdInput,
  webhookEndpointIdInput,
} from '../contracts/schemas';
import { validateWebhookUrl } from '../domain/network';
import { systemLabel } from '../domain/references';
import { deriveWebhookSecret } from '../domain/signing';
import { WEBHOOK_TEST_EVENT, webhookEventLabel } from '../domain/webhooks';

const endpointSelect = {
  id: true,
  name: true,
  url: true,
  system: true,
  events: true,
  status: true,
  secretVersion: true,
  consecutiveFailures: true,
  failingSince: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  disabledAt: true,
  disabledReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebhookEndpointSelect;

type EndpointRow = Prisma.WebhookEndpointGetPayload<{ select: typeof endpointSelect }>;

function describeEndpoint(endpoint: EndpointRow) {
  return {
    ...endpoint,
    systemLabel: endpoint.system ? systemLabel(endpoint.system) : null,
    eventLabels: endpoint.events.map(webhookEventLabel),
  };
}

export type WebhookEndpointView = ReturnType<typeof describeEndpoint>;

/** URL para a auditoria: sem a query, que às vezes carrega um token do receptor. */
function auditUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search ? '?…' : ''}`;
}

function requireSigningSecret(ctx: UseCaseContext): string {
  const secret = ctx.deps.webhooks.signingSecret;
  if (!secret) {
    throw new BusinessRuleError(
      'Webhooks de saída desligados: configure OUTBOUND_WEBHOOK_SIGNING_SECRET no ambiente.',
    );
  }
  return secret;
}

function checkedUrl(ctx: UseCaseContext, url: string): string {
  const check = validateWebhookUrl(url, ctx.deps.webhooks.network);
  if (!check.ok) throw new ValidationError([{ path: 'url', message: check.message }]);
  return check.url.toString();
}

async function requireEndpoint(ctx: UseCaseContext, endpointId: string) {
  const endpoint = await ctx.tx.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: endpointSelect,
  });
  if (!endpoint) throw new NotFoundError('Destino de webhook não encontrado.');
  return endpoint;
}

function requestDispatch(ctx: UseCaseContext) {
  ctx.afterCommit(async () => {
    await ctx.deps.jobs.enqueue(JOBS.webhooksDispatch.name, {}, { singletonKey: 'webhooks' });
  });
}

/** Cadastra o destino (F12-02). O segredo de assinatura volta só nesta resposta. */
export const createWebhookEndpoint = defineUseCase({
  name: 'integrations.createWebhookEndpoint',
  access: 'integration.manage',
  input: createWebhookEndpointInput,
  async run(ctx, input) {
    const master = requireSigningSecret(ctx);
    const endpoint = await ctx.tx.webhookEndpoint.create({
      data: {
        name: input.name,
        url: checkedUrl(ctx, input.url),
        events: input.events,
        system: input.system ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        createdAt: ctx.now,
      },
      select: endpointSelect,
    });
    await ctx.audit({
      action: 'webhook_endpoint.create',
      entityType: 'webhook_endpoint',
      entityId: endpoint.id,
      changes: {
        name: [null, endpoint.name],
        url: [null, auditUrl(endpoint.url)],
        events: [null, endpoint.events],
      },
      metadata: { system: endpoint.system },
    });
    return {
      endpoint: describeEndpoint(endpoint),
      secret: deriveWebhookSecret(master, endpoint.id, endpoint.secretVersion),
    };
  },
});

export const updateWebhookEndpoint = defineUseCase({
  name: 'integrations.updateWebhookEndpoint',
  access: 'integration.manage',
  input: updateWebhookEndpointInput,
  async run(ctx, input) {
    const before = await requireEndpoint(ctx, input.endpointId);
    const data: Prisma.WebhookEndpointUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: checkedUrl(ctx, input.url) } : {}),
      ...(input.events !== undefined ? { events: input.events } : {}),
      ...(input.system !== undefined ? { system: input.system } : {}),
    };
    const after = await ctx.tx.webhookEndpoint.update({
      where: { id: before.id },
      data,
      select: endpointSelect,
    });
    const changes: Record<string, [unknown, unknown]> = {};
    if (before.name !== after.name) changes.name = [before.name, after.name];
    if (before.url !== after.url) changes.url = [auditUrl(before.url), auditUrl(after.url)];
    if (before.events.join() !== after.events.join())
      changes.events = [before.events, after.events];
    if (before.system !== after.system) changes.system = [before.system, after.system];
    if (Object.keys(changes).length > 0) {
      await ctx.audit({
        action: 'webhook_endpoint.update',
        entityType: 'webhook_endpoint',
        entityId: after.id,
        changes,
      });
    }
    return describeEndpoint(after);
  },
});

/**
 * Pausa ou reativa. Reativar um destino desligado por falhas zera a contagem;
 * as entregas guardadas enquanto estava fora seguem na fila.
 */
export const setWebhookEndpointStatus = defineUseCase({
  name: 'integrations.setWebhookEndpointStatus',
  access: 'integration.manage',
  input: setWebhookEndpointStatusInput,
  async run(ctx, input) {
    const before = await requireEndpoint(ctx, input.endpointId);
    if (before.status === input.status) return describeEndpoint(before);
    const after = await ctx.tx.webhookEndpoint.update({
      where: { id: before.id },
      data:
        input.status === 'ACTIVE'
          ? {
              status: 'ACTIVE',
              consecutiveFailures: 0,
              failingSince: null,
              disabledAt: null,
              disabledReason: null,
            }
          : { status: 'PAUSED' },
      select: endpointSelect,
    });
    await ctx.audit({
      action: input.status === 'ACTIVE' ? 'webhook_endpoint.activate' : 'webhook_endpoint.pause',
      entityType: 'webhook_endpoint',
      entityId: after.id,
      changes: { status: [before.status, after.status] },
      metadata: before.disabledReason ? { disabledReason: before.disabledReason } : null,
    });
    if (after.status === 'ACTIVE') requestDispatch(ctx);
    return describeEndpoint(after);
  },
});

/** Novo segredo de assinatura (o anterior deixa de valer na hora). */
export const rotateWebhookSecret = defineUseCase({
  name: 'integrations.rotateWebhookSecret',
  access: 'integration.manage',
  input: webhookEndpointIdInput,
  async run(ctx, input) {
    const master = requireSigningSecret(ctx);
    const before = await requireEndpoint(ctx, input.endpointId);
    const after = await ctx.tx.webhookEndpoint.update({
      where: { id: before.id },
      data: { secretVersion: { increment: 1 } },
      select: endpointSelect,
    });
    await ctx.audit({
      action: 'webhook_endpoint.rotate_secret',
      entityType: 'webhook_endpoint',
      entityId: after.id,
      changes: { secretVersion: [before.secretVersion, after.secretVersion] },
    });
    return {
      endpoint: describeEndpoint(after),
      secret: deriveWebhookSecret(master, after.id, after.secretVersion),
    };
  },
});

/** Destinos com a situação das entregas (na fila, falhas nos últimos 7 dias). */
export const listWebhookEndpoints = defineUseCase({
  name: 'integrations.listWebhookEndpoints',
  access: 'integration.manage',
  input: webhookEndpointIdInput.partial(),
  async run(ctx, input) {
    const endpoints = await ctx.tx.webhookEndpoint.findMany({
      where: input.endpointId ? { id: input.endpointId } : {},
      select: endpointSelect,
      orderBy: { createdAt: 'asc' },
    });
    const ids = endpoints.map((e) => e.id);
    const weekAgo = new Date(ctx.now.getTime() - 7 * 86_400_000);
    const [pending, failed] = await Promise.all([
      ctx.tx.webhookDelivery.groupBy({
        by: ['endpointId'],
        where: { endpointId: { in: ids }, status: 'PENDING' },
        _count: { _all: true },
      }),
      ctx.tx.webhookDelivery.groupBy({
        by: ['endpointId'],
        where: { endpointId: { in: ids }, status: 'FAILED', lastAttemptAt: { gte: weekAgo } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: typeof pending, endpointId: string) =>
      rows.find((r) => r.endpointId === endpointId)?._count._all ?? 0;
    return {
      enabled: ctx.deps.webhooks.signingSecret !== null,
      data: endpoints.map((endpoint) => ({
        ...describeEndpoint(endpoint),
        pendingDeliveries: count(pending, endpoint.id),
        failedLastWeek: count(failed, endpoint.id),
      })),
    };
  },
});

/** Registro das entregas (mais recentes primeiro), com o corpo do evento. */
export const listWebhookDeliveries = defineUseCase({
  name: 'integrations.listWebhookDeliveries',
  access: 'integration.manage',
  input: listWebhookDeliveriesInput,
  async run(ctx, input) {
    const rows = await ctx.tx.webhookDelivery.findMany({
      where: {
        ...(input.endpointId ? { endpointId: input.endpointId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: input.limit + 1,
      select: {
        id: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        lastAttemptAt: true,
        lastStatusCode: true,
        lastError: true,
        lastDurationMs: true,
        deliveredAt: true,
        manual: true,
        createdAt: true,
        endpoint: { select: { id: true, name: true } },
        event: { select: { id: true, type: true, occurredAt: true, payload: true } },
      },
    });
    const page = rows.slice(0, input.limit);
    return {
      data: page.map((row) => ({ ...row, eventLabel: webhookEventLabel(row.event.type) })),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
    };
  },
});

/** "Enviar teste": um evento webhook.test só para este destino (mesmo pausado). */
export const sendTestWebhook = defineUseCase({
  name: 'integrations.sendTestWebhook',
  access: 'integration.manage',
  input: webhookEndpointIdInput,
  async run(ctx, input) {
    requireSigningSecret(ctx);
    const endpoint = await requireEndpoint(ctx, input.endpointId);
    const event = await ctx.tx.outboundEvent.create({
      data: {
        id: newId(),
        type: WEBHOOK_TEST_EVENT,
        occurredAt: ctx.now,
        payload: {
          message: 'Teste de webhook da Docline SDR.',
          endpoint: { id: endpoint.id, name: endpoint.name },
        },
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    const delivery = await ctx.tx.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId: event.id,
        nextAttemptAt: ctx.now,
        manual: true,
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    await ctx.audit({
      action: 'webhook_endpoint.test',
      entityType: 'webhook_endpoint',
      entityId: endpoint.id,
      metadata: { deliveryId: delivery.id },
    });
    requestDispatch(ctx);
    return { deliveryId: delivery.id, eventId: event.id };
  },
});

/** Reenvia uma entrega encerrada: nova entrega do mesmo evento, do zero. */
export const resendWebhookDelivery = defineUseCase({
  name: 'integrations.resendWebhookDelivery',
  access: 'integration.manage',
  input: webhookDeliveryIdInput,
  async run(ctx, input) {
    requireSigningSecret(ctx);
    const original = await ctx.tx.webhookDelivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, status: true, endpointId: true, eventId: true },
    });
    if (!original) throw new NotFoundError('Entrega não encontrada.');
    if (original.status === 'PENDING') {
      throw new ConflictError('Esta entrega ainda está na fila; aguarde a próxima tentativa.');
    }
    const delivery = await ctx.tx.webhookDelivery.create({
      data: {
        endpointId: original.endpointId,
        eventId: original.eventId,
        nextAttemptAt: ctx.now,
        manual: true,
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    await ctx.audit({
      action: 'webhook_delivery.resend',
      entityType: 'webhook_delivery',
      entityId: original.id,
      metadata: { newDeliveryId: delivery.id, endpointId: original.endpointId },
    });
    requestDispatch(ctx);
    return { deliveryId: delivery.id };
  },
});
