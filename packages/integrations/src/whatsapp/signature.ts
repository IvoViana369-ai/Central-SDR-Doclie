import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Segurança dos webhooks da Meta (docs/INTEGRATIONS.md §6.2 e §13):
 * - POST: `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 do corpo bruto com o
 *   app secret, comparado em tempo constante;
 * - GET de verificação: `hub.mode=subscribe`, `hub.verify_token` igual ao nosso
 *   e devolução do `hub.challenge`.
 */

export function signMetaPayload(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function verifyMetaSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  appSecret: string,
): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signMetaPayload(rawBody, appSecret).slice(7), 'hex');
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Desafio a devolver na verificação do endpoint, ou `null` se o pedido não é legítimo. */
export function verifyWebhookChallenge(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe' || !token || !challenge || challenge.length > 200) return null;
  return sameText(token, verifyToken) ? challenge : null;
}
