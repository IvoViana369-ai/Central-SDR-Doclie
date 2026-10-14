/**
 * Webhooks de saída (F12-02; docs/INTEGRATIONS.md §11.2): catálogo de eventos,
 * agenda de novas tentativas e regra de desligamento automático. A assinatura
 * (HMAC) fica em `signing.ts`, fora deste arquivo seguro para a interface.
 */

/** Versão do formato do corpo enviado; muda só com quebra de compatibilidade. */
export const WEBHOOK_API_VERSION = '2026-10-14';

/**
 * Eventos que um destino pode assinar. O corpo leva ids, códigos e valores
 * mascarados; o sistema que precisa de mais busca pela API com chave.
 */
export const WEBHOOK_EVENTS = {
  'opportunity.created': {
    label: 'Oportunidade criada',
    description: 'O SDR transferiu o lead ao Comercial (checklist de qualificação preenchido).',
  },
  'opportunity.accepted': {
    label: 'Transferência aceita',
    description: 'O Comercial aceitou a oportunidade.',
  },
  'lead.converted': {
    label: 'Lead convertido',
    description: 'Oportunidade ganha: o escritório virou cliente ou parceiro.',
  },
  'opportunity.lost': {
    label: 'Oportunidade perdida',
    description: 'O Comercial encerrou a oportunidade como perdida, com o motivo.',
  },
  'optout.registered': {
    label: 'Opt-out registrado',
    description:
      'Identificador incluído na Lista Não Contatar (por pedido, palavra-chave, ADMIN ou outro sistema).',
  },
  'suppression.revoked': {
    label: 'Não Contatar revogado',
    description: 'O ADMIN revogou um registro da Lista Não Contatar, com motivo.',
  },
} as const satisfies Record<string, { label: string; description: string }>;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;

export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

/** Evento só do botão "Enviar teste" (não se assina). */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export function isWebhookEventType(value: string): value is WebhookEventType {
  return Object.hasOwn(WEBHOOK_EVENTS, value);
}

export function webhookEventLabel(type: string): string {
  if (type === WEBHOOK_TEST_EVENT) return 'Teste';
  return isWebhookEventType(type) ? WEBHOOK_EVENTS[type].label : type;
}

/**
 * Esperas depois de cada falha: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h e 24 h.
 * Com a 1ª tentativa, são 8 envios em cerca de 45 horas; depois, FAILED.
 */
export const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
] as const;

export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

/** Tempo de resposta de cada envio e reserva da entrega durante o envio. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_LEASE_MS = 2 * 60_000;

/** Próxima tentativa depois da falha número `attempts` (1 = a primeira); null = desistir. */
export function nextAttemptAt(attempts: number, failedAt: Date): Date | null {
  if (attempts >= WEBHOOK_MAX_ATTEMPTS) return null;
  const delay = WEBHOOK_RETRY_DELAYS_MS[Math.max(0, attempts - 1)]!;
  return new Date(failedAt.getTime() + delay);
}

/** Desliga o destino com 20 falhas seguidas e pelo menos 24 h falhando. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
export const WEBHOOK_DISABLE_AFTER_MS = 24 * 3_600_000;

export function shouldDisableEndpoint(
  endpoint: { consecutiveFailures: number; failingSince: Date | null },
  now: Date,
): boolean {
  return (
    endpoint.consecutiveFailures >= WEBHOOK_DISABLE_AFTER_FAILURES &&
    endpoint.failingSince !== null &&
    now.getTime() - endpoint.failingSince.getTime() >= WEBHOOK_DISABLE_AFTER_MS
  );
}

/** Sucesso só com 2xx; redirecionamentos não são seguidos (docs/SECURITY.md §10). */
export function isDeliverySuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Erro curto para o registro da entrega (sem quebras de linha, até 300 caracteres). */
export function deliveryErrorText(status: number | null, detail: string): string {
  const clean = detail.replace(/\s+/g, ' ').trim().slice(0, 280);
  if (status === null) return clean || 'Falha de rede.';
  if (status >= 300 && status < 400) return `HTTP ${status}: redirecionamento não é seguido.`;
  return clean ? `HTTP ${status}: ${clean}` : `HTTP ${status}`;
}

export interface WebhookBody {
  id: string;
  type: string;
  occurredAt: string;
  apiVersion: string;
  data: unknown;
}

/** Corpo JSON enviado (o mesmo texto que é assinado). */
export function buildWebhookBody(event: {
  id: string;
  type: string;
  occurredAt: Date;
  data: unknown;
}): string {
  const body: WebhookBody = {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    apiVersion: WEBHOOK_API_VERSION,
    data: event.data,
  };
  return JSON.stringify(body);
}
