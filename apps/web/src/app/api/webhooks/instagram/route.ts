import { receiveInstagramWebhook, systemActor, ValidationError } from '@docline/core';
import {
  verifyMetaSignature,
  verifyWebhookChallenge,
  instagramWebhookConfig,
} from '@docline/integrations';
import { getContainer } from '@/server/container';
import { ipAddressOptions, requestMetaFrom } from '@/server/request-meta';

/**
 * Webhook do Instagram (docs/INTEGRATIONS.md §7.2): mensagens, ecos, "visto" e
 * comentários da conta profissional da Docline. Público, sem sessão: a
 * autenticidade vem da assinatura da Meta (X-Hub-Signature-256, HMAC do corpo
 * com o app secret, o mesmo app do WhatsApp). Responde rápido; o worker
 * processa. No modo assistido (ou sem os segredos), não existe.
 */

const MAX_BODY_BYTES = 1_000_000;
const NO_STORE = { 'cache-control': 'no-store' };

function notFound() {
  return new Response('Not found', { status: 404, headers: NO_STORE });
}

/** Verificação do endpoint pela Meta (hub.mode, hub.verify_token, hub.challenge). */
export async function GET(request: Request) {
  const { env } = getContainer();
  const config = instagramWebhookConfig(env);
  if (!config) return notFound();
  const challenge = verifyWebhookChallenge(new URL(request.url).searchParams, config.verifyToken);
  if (!challenge) return new Response('Forbidden', { status: 403, headers: NO_STORE });
  return new Response(challenge, {
    status: 200,
    headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: Request) {
  const { env, deps, logger, errors } = getContainer();
  const config = instagramWebhookConfig(env);
  if (!config || !deps.instagram) return notFound();
  const meta = requestMetaFrom(request.headers, ipAddressOptions(env.TRUSTED_PROXIES));

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413, headers: NO_STORE });
  }
  // A assinatura é sobre os bytes exatos recebidos.
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413, headers: NO_STORE });
  }
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    // Registro de segurança sem o conteúdo (pode ser lixo ou tentativa de forjar eventos).
    logger.warn(
      { ip: meta.ip, requestId: meta.requestId },
      'Webhook do Instagram com assinatura inválida',
    );
    return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  }

  try {
    const result = await receiveInstagramWebhook(
      deps,
      systemActor('webhook:instagram'),
      { provider: deps.instagram.name, rawBody: raw.toString('utf8') },
      meta,
    );
    return Response.json({ received: true, duplicate: result.duplicate }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn({ requestId: meta.requestId }, 'Webhook do Instagram fora do formato');
      return new Response('Bad request', { status: 400, headers: NO_STORE });
    }
    // A Meta tenta de novo: nada se perde, e a inbox é idempotente.
    logger.error(
      { err: error, requestId: meta.requestId },
      'Falha ao receber webhook do Instagram',
    );
    errors.capture(error, { requestId: meta.requestId, route: '/api/webhooks/instagram' });
    return new Response('Error', { status: 500, headers: NO_STORE });
  }
}
