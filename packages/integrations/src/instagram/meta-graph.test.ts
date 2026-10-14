import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InstagramProviderError } from '@docline/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaGraphInstagramProvider, type MetaGraphInstagramConfig } from './meta-graph';

/** Servidor local que imita a Graph API: sem rede, sem conta da Meta. */
let server: Server;
let baseUrl = '';
type Reply = { status: number; body: unknown; delayMs?: number };
let replies: Reply[] = [];
let received: {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      const reply = replies.shift() ?? { status: 200, body: {} };
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  replies = [];
  received = [];
});

const TOKEN = 'token-da-pagina-de-teste-nao-real';
const provider = (overrides: Partial<MetaGraphInstagramConfig> = {}) =>
  new MetaGraphInstagramProvider({
    pageAccessToken: TOKEN,
    apiVersion: 'v26.0',
    pageId: '300000000000003',
    accountId: '17841400000000000',
    allowSends: true,
    baseUrl,
    timeoutMs: 300,
    ...overrides,
  });

const metaError = (status: number, code: number, subcode?: number) => ({
  status,
  body: {
    error: {
      message: 'erro',
      type: 'OAuthException',
      code,
      ...(subcode ? { error_subcode: subcode } : {}),
      fbtrace_id: 'x',
    },
  },
});

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InstagramProviderError);
    return error as InstagramProviderError;
  }
  throw new Error('Era esperada uma falha.');
}

describe('mensagens', () => {
  it('texto para quem escreveu e resposta privada a comentário, pela Página', async () => {
    replies = [
      { status: 200, body: { recipient_id: 'igsid-1', message_id: 'mid-1' } },
      { status: 200, body: { recipient_id: 'igsid-2', message_id: 'mid-2' } },
    ];
    const ig = provider();
    expect(await ig.sendText({ recipientId: 'igsid-1', text: 'Olá! (fictício)' })).toEqual({
      providerMessageId: 'mid-1',
      recipientId: 'igsid-1',
    });
    expect(await ig.sendPrivateReply({ commentId: 'comment-1', text: 'Oi!' })).toEqual({
      providerMessageId: 'mid-2',
      recipientId: 'igsid-2',
    });
    expect(received.map((r) => [r.method, r.url, r.headers.authorization, r.body])).toEqual([
      [
        'POST',
        '/v26.0/300000000000003/messages',
        `Bearer ${TOKEN}`,
        { recipient: { id: 'igsid-1' }, message: { text: 'Olá! (fictício)' } },
      ],
      [
        'POST',
        '/v26.0/300000000000003/messages',
        `Bearer ${TOKEN}`,
        { recipient: { comment_id: 'comment-1' }, message: { text: 'Oi!' } },
      ],
    ]);
  });

  it('fora de produção, sem ALLOW_REAL_SENDS, nada sai', async () => {
    const error = await failure(
      provider({ allowSends: false }).sendText({ recipientId: 'x', text: 'Olá' }),
    );
    expect(error.details).toEqual({
      outcome: 'NOT_SENT',
      retryable: false,
      code: 'REAL_SENDS_DISABLED',
    });
    expect(received).toHaveLength(0);
  });

  it('falhas: janela fechada, limite, 5xx incerto, tempo esgotado e resposta sem id', async () => {
    const ig = provider();
    replies = [metaError(400, 10, 2018278)];
    const closed = await failure(ig.sendText({ recipientId: 'x', text: 'Olá' }));
    expect(closed.details).toEqual({
      outcome: 'NOT_SENT',
      retryable: false,
      code: '10/2018278',
      httpStatus: 400,
    });
    expect(closed.message).toContain('24 horas');

    replies = [metaError(429, 613)];
    expect((await failure(ig.sendText({ recipientId: 'x', text: 'Olá' }))).details).toMatchObject({
      outcome: 'NOT_SENT',
      retryable: true,
      code: '613',
    });

    // 5xx sem código conhecido num envio: a Meta pode ter aceitado.
    replies = [{ status: 502, body: 'Bad gateway' }];
    expect((await failure(ig.sendText({ recipientId: 'x', text: 'Olá' }))).details).toMatchObject({
      outcome: 'UNKNOWN',
      code: 'HTTP_502',
    });

    replies = [{ status: 200, body: {}, delayMs: 1_000 }];
    expect((await failure(ig.sendText({ recipientId: 'x', text: 'Olá' }))).details).toMatchObject({
      outcome: 'UNKNOWN',
      retryable: false,
      code: 'TIMEOUT',
    });

    replies = [{ status: 200, body: { recipient_id: 'x' } }];
    const invalid = await failure(ig.sendPrivateReply({ commentId: 'c', text: 'Oi' }));
    expect(invalid.details).toMatchObject({ outcome: 'UNKNOWN', code: 'INVALID_RESPONSE' });
    // Nada de token ou texto nas mensagens de erro.
    for (const error of [closed, invalid]) {
      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain('Olá');
    }
  });
});

describe('perfis', () => {
  it('perfil de quem escreveu; sem consentimento vem nulo; token inválido é falha', async () => {
    const ig = provider();
    replies = [{ status: 200, body: { username: 'Escritorio.Exemplo', name: 'Escritório' } }];
    expect(await ig.getUserProfile('igsid-1')).toEqual({
      username: 'escritorio.exemplo',
      name: 'Escritório',
    });
    expect(received[0]?.url).toBe('/v26.0/igsid-1?fields=name,username');

    replies = [metaError(400, 230)];
    expect(await ig.getUserProfile('igsid-2')).toBeNull();

    replies = [metaError(401, 190)];
    expect((await failure(ig.getUserProfile('igsid-3'))).details.code).toBe('190');
  });

  it('Business Discovery: métricas, conta que não aparece, @ inválido e limite', async () => {
    const ig = provider();
    replies = [
      {
        status: 200,
        body: {
          business_discovery: {
            followers_count: 1520,
            media_count: 87,
            media: { data: [{ timestamp: '2026-10-01T12:00:00+0000', id: 'm1' }] },
            id: '178',
          },
          id: '17841400000000000',
        },
      },
    ];
    expect(await ig.discover('escritorio.exemplo')).toEqual({
      found: true,
      followersCount: 1520,
      mediaCount: 87,
      lastPostAt: new Date('2026-10-01T12:00:00Z'),
    });
    expect(decodeURIComponent(received[0]!.url!)).toBe(
      '/v26.0/17841400000000000?fields=business_discovery.username(escritorio.exemplo){followers_count,media_count,media.limit(1){timestamp}}',
    );

    replies = [
      { status: 200, body: { business_discovery: { followers_count: 3, media_count: 0 } } },
    ];
    expect(await ig.discover('sem.posts')).toEqual({
      found: true,
      followersCount: 3,
      mediaCount: 0,
      lastPostAt: null,
    });

    // Conta inexistente ou pessoal: a Meta recusa o pedido.
    replies = [metaError(400, 110, 2207013)];
    expect(await ig.discover('perfil.pessoal')).toEqual({ found: false });

    // @ inválido nem chega à Meta (nada de injeção nos campos).
    const before = received.length;
    expect(await ig.discover('a){id}')).toEqual({ found: false });
    expect(received).toHaveLength(before);

    replies = [metaError(429, 4)];
    expect((await failure(ig.discover('escritorio.exemplo'))).details).toMatchObject({
      retryable: true,
      code: '4',
    });
  });

  it('dados da conta da Docline', async () => {
    replies = [
      {
        status: 200,
        body: { id: '17841400000000000', username: 'docline', name: 'Docline', followers_count: 9 },
      },
    ];
    expect(await provider().getAccount()).toEqual({
      id: '17841400000000000',
      username: 'docline',
      name: 'Docline',
      followersCount: 9,
    });
  });
});
