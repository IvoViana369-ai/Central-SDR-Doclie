/**
 * Prazos da API do Instagram (docs/INTEGRATIONS.md §7.2, conferidos na
 * documentação da Meta em 2026-10-09):
 * - mensagem para quem escreveu: até 24 h depois da última mensagem da pessoa;
 * - resposta privada a um comentário: uma por comentário, até 7 dias depois dele.
 * Depois disso, só pelo app do Instagram (assistido), se fizer sentido.
 */

export const MESSAGING_WINDOW_HOURS = 24;
export const PRIVATE_REPLY_DAYS = 7;
const HOUR_MS = 3_600_000;

export function messagingWindowExpiry(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + MESSAGING_WINDOW_HOURS * HOUR_MS);
}

export interface MessagingWindow {
  open: boolean;
  expiresAt: Date | null;
}

export function messagingWindow(expiresAt: Date | null | undefined, now: Date): MessagingWindow {
  const expiry = expiresAt ?? null;
  return { open: expiry !== null && expiry > now, expiresAt: expiry };
}

export function privateReplyDeadline(commentedAt: Date): Date {
  return new Date(commentedAt.getTime() + PRIVATE_REPLY_DAYS * 24 * HOUR_MS);
}

export type PrivateReplyState = 'available' | 'sent' | 'expired';

export function privateReplyState(
  comment: { commentedAt: Date; privateReplyMessageId: string | null },
  now: Date,
): PrivateReplyState {
  if (comment.privateReplyMessageId) return 'sent';
  return privateReplyDeadline(comment.commentedAt) > now ? 'available' : 'expired';
}
