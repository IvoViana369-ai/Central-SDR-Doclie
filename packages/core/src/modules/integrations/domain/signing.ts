import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { apiKeyPrefix } from './references';

/**
 * Criptografia das integrações (usa node:crypto; fora do index seguro para a
 * interface). Chaves de API: só o SHA-256 vai para o banco. Webhooks: HMAC
 * SHA-256 sobre "timestamp.corpo", com um segredo por destino derivado do
 * segredo mestre (OUTBOUND_WEBHOOK_SIGNING_SECRET), do id e da versão.
 */

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomAlphanumeric(length: number): string {
  // 62 símbolos: descarta bytes ≥ 248 para não enviesar a distribuição.
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHANUMERIC[byte % 62];
    }
  }
  return out;
}

export interface GeneratedApiKey {
  /** A chave inteira: mostrada uma única vez. */
  key: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const key = `dsdr_${randomAlphanumeric(8)}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: apiKeyPrefix(key)!, hash: hashApiKey(key) };
}

/** Segredo de assinatura de um destino ("whsec_…"); muda quando a versão muda. */
export function deriveWebhookSecret(masterSecret: string, endpointId: string, version: number) {
  const mac = createHmac('sha256', masterSecret)
    .update(`webhook-endpoint:${endpointId}:v${version}`, 'utf8')
    .digest('base64url');
  return `whsec_${mac}`;
}

export const SIGNATURE_HEADER = 'Docline-Signature';
/** Tolerância recomendada aos receptores para o timestamp da assinatura. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function hmacHex(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/** Valor do cabeçalho Docline-Signature: "t=<unix>,v1=<hex>". */
export function signWebhook(secret: string, body: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${timestamp},v1=${hmacHex(secret, timestamp, body)}`;
}

/**
 * Conferência do lado de quem recebe (documentada para os sistemas Docline e
 * usada nos testes): assinatura válida e timestamp dentro da tolerância.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  now: Date,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const i = part.indexOf('=');
      return [part.slice(0, i).trim(), part.slice(i + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1') ?? '';
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(hmacHex(secret, timestamp, body), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
