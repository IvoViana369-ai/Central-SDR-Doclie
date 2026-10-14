import type { MessageStatus } from '@docline/db';

/**
 * Janela de atendimento e status das mensagens do WhatsApp (docs/INTEGRATIONS.md
 * §6.2): texto livre só até 24 h depois da última mensagem do contato; fora
 * dela, só modelo aprovado.
 */

export const SERVICE_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

export function serviceWindowExpiry(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + SERVICE_WINDOW_HOURS * HOUR_MS);
}

export interface ServiceWindow {
  open: boolean;
  expiresAt: Date | null;
}

export function serviceWindow(expiresAt: Date | null | undefined, now: Date): ServiceWindow {
  const expiry = expiresAt ?? null;
  return { open: expiry !== null && expiry > now, expiresAt: expiry };
}

/** Ordem dos status de uma mensagem enviada (lida implica entregue, que implica enviada). */
const RANK: Partial<Record<MessageStatus, number>> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Status novo de uma mensagem enviada a partir de um webhook, ou `null` se
 * nada muda. Os webhooks podem chegar fora de ordem (lida antes de entregue):
 * o status nunca volta. Uma falha só vale antes da entrega; e um status de
 * sucesso corrige uma falha de resultado incerto (a mensagem tinha saído).
 */
export function nextDeliveryStatus(
  current: MessageStatus,
  incoming: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
): MessageStatus | null {
  if (current === 'CANCELED' || current === 'RECEIVED' || current === 'PENDING_CONFIRMATION') {
    return null;
  }
  if (incoming === 'FAILED') {
    return current === 'QUEUED' || current === 'SENT' ? 'FAILED' : null;
  }
  if (current === 'FAILED') return incoming;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : null;
}
