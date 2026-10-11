import { WebhookTransportError } from '../../../ports/webhook';
import { systemActor } from '../../../shared/actor';
import { auditData, type CoreDeps } from '../../../shared/use-case';
import { notify } from '../../notifications';
import { deriveWebhookSecret, signWebhook } from '../domain/signing';
import {
  WEBHOOK_LEASE_MS,
  WEBHOOK_TIMEOUT_MS,
  buildWebhookBody,
  deliveryErrorText,
  isDeliverySuccess,
  nextAttemptAt,
  shouldDisableEndpoint,
} from '../domain/webhooks';

/** Entregas por lote, envios simultâneos e tempo máximo de uma rodada. */
const BATCH_SIZE = 50;
const CONCURRENCY = 5;
const MAX_RUN_MS = 45_000;
/** Eventos (e entregas) com mais de 90 dias saem na limpeza diária. */
export const OUTBOUND_EVENT_RETENTION_DAYS = 90;

interface ClaimedDelivery {
  id: string;
  endpoint_id: string;
  event_id: string;
  attempts: number;
}

export interface DispatchResult {
  skipped?: 'NO_SECRET';
  sent: number;
  succeeded: number;
  failed: number;
  disabledEndpoints: string[];
}

/**
 * Reserva as entregas vencidas (de destinos ativos, ou pedidas por uma pessoa)
 * empurrando `next_attempt_at` e contando a tentativa; `SKIP LOCKED` evita que
 * dois workers peguem a mesma. Se o worker cair no meio, a reserva vence e a
 * entrega volta.
 */
async function claim(deps: CoreDeps, now: Date): Promise<ClaimedDelivery[]> {
  const lease = new Date(now.getTime() + WEBHOOK_LEASE_MS);
  return deps.db.$queryRaw<ClaimedDelivery[]>`
    UPDATE webhook_deliveries d SET
      next_attempt_at = ${lease}::timestamptz,
      attempts = d.attempts + 1,
      last_attempt_at = ${now}::timestamptz
    WHERE d.id IN (
      SELECT d2.id FROM webhook_deliveries d2
      JOIN webhook_endpoints e ON e.id = d2.endpoint_id
      WHERE d2.status = 'PENDING'
        AND d2.next_attempt_at <= ${now}::timestamptz
        AND (e.status = 'ACTIVE' OR d2.manual)
      ORDER BY d2.next_attempt_at, d2.id
      LIMIT ${BATCH_SIZE}
      FOR UPDATE OF d2 SKIP LOCKED
    )
    RETURNING d.id, d.endpoint_id, d.event_id, d.attempts`;
}

type Outcome =
  | { ok: true; status: number; durationMs: number }
  | { ok: false; status: number | null; error: string; durationMs: number | null };

async function deliver(
  deps: CoreDeps,
  master: string,
  delivery: ClaimedDelivery,
  endpoint: { id: string; url: string; secretVersion: number },
  event: { id: string; type: string; occurredAt: Date; payload: unknown },
): Promise<Outcome> {
  const body = buildWebhookBody({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    data: event.payload,
  });
  const secret = deriveWebhookSecret(master, endpoint.id, endpoint.secretVersion);
  try {
    const response = await deps.webhooks.sender.send({
      url: endpoint.url,
      body,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'DoclineSDR-Webhooks/1.0',
        'docline-event': event.type,
        'docline-event-id': event.id,
        'docline-delivery-id': delivery.id,
        'docline-delivery-attempt': String(delivery.attempts),
        'docline-signature': signWebhook(secret, body, deps.clock.now()),
      },
    });
    if (isDeliverySuccess(response.status)) {
      return { ok: true, status: response.status, durationMs: response.durationMs };
    }
    return {
      ok: false,
      status: response.status,
      error: deliveryErrorText(response.status, response.body),
      durationMs: response.durationMs,
    };
  } catch (error) {
    const message =
      error instanceof WebhookTransportError ? error.message : 'Falha inesperada no envio.';
    if (!(error instanceof WebhookTransportError)) {
      deps.logger.error({ err: error, deliveryId: delivery.id }, 'Falha inesperada no webhook');
    }
    return { ok: false, status: null, error: deliveryErrorText(null, message), durationMs: null };
  }
}

/** Grava o resultado da tentativa e a saúde do destino (pode desligá-lo). */
async function record(
  deps: CoreDeps,
  delivery: ClaimedDelivery,
  outcome: Outcome,
  now: Date,
): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    if (outcome.ok) {
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCEEDED',
          deliveredAt: now,
          nextAttemptAt: now,
          lastStatusCode: outcome.status,
          lastDurationMs: outcome.durationMs,
          lastError: null,
        },
      });
      await tx.webhookEndpoint.update({
        where: { id: delivery.endpoint_id },
        data: { consecutiveFailures: 0, failingSince: null, lastSuccessAt: now },
      });
      return null;
    }

    const next = nextAttemptAt(delivery.attempts, now);
    await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: next ? 'PENDING' : 'FAILED',
        nextAttemptAt: next ?? now,
        lastStatusCode: outcome.status,
        lastDurationMs: outcome.durationMs,
        lastError: outcome.error,
      },
    });
    const [endpoint] = await tx.$queryRaw<
      { status: string; consecutive_failures: number; failing_since: Date | null; name: string }[]
    >`
      UPDATE webhook_endpoints SET
        consecutive_failures = consecutive_failures + 1,
        failing_since = COALESCE(failing_since, ${now}::timestamptz),
        last_failure_at = ${now}::timestamptz,
        updated_at = ${now}::timestamptz
      WHERE id = ${delivery.endpoint_id}::uuid
      RETURNING status, consecutive_failures, failing_since, name`;
    if (
      !endpoint ||
      endpoint.status !== 'ACTIVE' ||
      !shouldDisableEndpoint(
        {
          consecutiveFailures: endpoint.consecutive_failures,
          failingSince: endpoint.failing_since,
        },
        now,
      )
    ) {
      return null;
    }

    // Desliga sozinho: as entregas ficam na fila e os ADMINs são avisados.
    const reason = `${endpoint.consecutive_failures} falhas seguidas desde ${endpoint.failing_since!.toISOString()}.`;
    await tx.webhookEndpoint.update({
      where: { id: delivery.endpoint_id },
      data: { status: 'DISABLED', disabledAt: now, disabledReason: reason },
    });
    await tx.auditLog.create({
      data: {
        ...auditData(
          systemActor('webhooks.dispatch'),
          {},
          {
            action: 'webhook_endpoint.auto_disable',
            entityType: 'webhook_endpoint',
            entityId: delivery.endpoint_id,
            changes: { status: ['ACTIVE', 'DISABLED'] },
            metadata: { reason, lastError: outcome.error },
          },
        ),
        occurredAt: now,
      },
    });
    const admins = await tx.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    for (const admin of admins) {
      await notify(tx, {
        userId: admin.id,
        type: 'webhook.disabled',
        title: `Webhook desligado: ${endpoint.name}`,
        body: `${reason} Corrija o destino e reative em Configurações → Integrações Docline.`,
        link: '/configuracoes/integracoes',
      });
    }
    return delivery.endpoint_id;
  });
}

/**
 * Job `webhooks.dispatch` (F12-02): envia as entregas vencidas, assinadas, com
 * novas tentativas e desligamento automático. Roda de minuto em minuto e logo
 * depois de cada evento publicado.
 */
export async function runWebhookDispatch(deps: CoreDeps): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, succeeded: 0, failed: 0, disabledEndpoints: [] };
  const master = deps.webhooks.signingSecret;
  if (!master) return { ...result, skipped: 'NO_SECRET' };
  const started = Date.now();

  while (Date.now() - started < MAX_RUN_MS) {
    const claimed = await claim(deps, deps.clock.now());
    if (claimed.length === 0) break;
    const [endpoints, events] = await Promise.all([
      deps.db.webhookEndpoint.findMany({
        where: { id: { in: [...new Set(claimed.map((d) => d.endpoint_id))] } },
        select: { id: true, url: true, secretVersion: true },
      }),
      deps.db.outboundEvent.findMany({
        where: { id: { in: [...new Set(claimed.map((d) => d.event_id))] } },
        select: { id: true, type: true, occurredAt: true, payload: true },
      }),
    ]);
    const endpointById = new Map(endpoints.map((e) => [e.id, e]));
    const eventById = new Map(events.map((e) => [e.id, e]));

    let index = 0;
    const worker = async () => {
      while (index < claimed.length) {
        const delivery = claimed[index++]!;
        const endpoint = endpointById.get(delivery.endpoint_id);
        const event = eventById.get(delivery.event_id);
        if (!endpoint || !event) continue;
        const outcome = await deliver(deps, master, delivery, endpoint, event);
        const disabled = await record(deps, delivery, outcome, deps.clock.now());
        result.sent += 1;
        if (outcome.ok) result.succeeded += 1;
        else result.failed += 1;
        if (disabled) result.disabledEndpoints.push(disabled);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (claimed.length < BATCH_SIZE) break;
  }
  return result;
}

/** Limpeza diária: eventos com mais de 90 dias (as entregas vão junto). */
export async function purgeOutboundEvents(deps: CoreDeps): Promise<{ deleted: number }> {
  const cutoff = new Date(deps.clock.now().getTime() - OUTBOUND_EVENT_RETENTION_DAYS * 86_400_000);
  const { count } = await deps.db.outboundEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: count };
}
