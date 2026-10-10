import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WhatsappProviderError } from '@docline/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaCloudWhatsappProvider, type MetaCloudConfig } from './meta-cloud';

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

const TOKEN = 'token-de-teste-nao-real';
const provider = (overrides: Partial<MetaCloudConfig> = {}) =>
  new MetaCloudWhatsappProvider({
    accessToken: TOKEN,
    apiVersion: 'v26.0',
    phoneNumberId: '200000000000002',
    businessAccountId: '100000000000001',
    allowSends: true,
    baseUrl,
    timeoutMs: 300,
    ...overrides,
  });

const accepted = (id = 'wamid.ok', waId = '558898120001') => ({
  status: 200,
  body: {
    messaging_product: 'whatsapp',
    contacts: [{ input: '5588998120001', wa_id: waId }],
    messages: [{ id }],
  },
});

const metaError = (status: number, code: number) => ({
  status,
  body: { error: { message: 'erro', type: 'OAuthException', code, fbtrace_id: 'x' } },
});

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsappProviderError);
    return error as WhatsappProviderError;
  }
  throw new Error('esperava falha');
}

const text = { kind: 'text' as const, to: '5588998120001', reference: 'msg-1', body: 'Olá!' };

describe('MetaCloudWhatsappProvider', () => {
  it('envia texto com a versão fixada, token no cabeçalho e nosso id', async () => {
    replies = [accepted()];
    expect(await provider().send(text)).toEqual({
      providerMessageId: 'wamid.ok',
      waId: '558898120001',
    });
    const [call] = received;
    expect(call).toMatchObject({ method: 'POST', url: '/v26.0/200000000000002/messages' });
    expect(call!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call!.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5588998120001',
      biz_opaque_callback_data: 'msg-1',
      type: 'text',
      text: { body: 'Olá!', preview_url: false },
    });
  });

  it('envia modelo com variáveis posicionais ou nomeadas', async () => {
    replies = [accepted('wamid.a'), accepted('wamid.b')];
    const template = (parameterFormat: 'POSITIONAL' | 'NAMED') => ({
      kind: 'template' as const,
      to: '5588998120001',
      reference: 'msg-2',
      template: {
        name: 'apresentacao_parceria',
        language: 'pt_BR',
        parameterFormat,
        bodyParameters: [{ name: parameterFormat === 'NAMED' ? 'nome' : '1', value: 'Ana' }],
      },
    });
    await provider().send(template('POSITIONAL'));
    await provider().send(template('NAMED'));
    expect(received.map((r) => (r.body as { template: unknown }).template)).toEqual([
      {
        name: 'apresentacao_parceria',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
      },
      {
        name: 'apresentacao_parceria',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', parameter_name: 'nome', text: 'Ana' }] },
        ],
      },
    ]);
  });

  it('fora de produção sem ALLOW_REAL_SENDS, não chama a Meta', async () => {
    const error = await failure(provider({ allowSends: false }).send(text));
    expect(error.details).toMatchObject({ code: 'REAL_SENDS_DISABLED', outcome: 'NOT_SENT' });
    expect(received).toEqual([]);
  });

  it('traduz os erros da Meta: janela fechada, limite e erro desconhecido do servidor', async () => {
    replies = [
      metaError(400, 131047),
      metaError(429, 130429),
      metaError(500, 1),
      metaError(500, 1),
    ];
    expect((await failure(provider().send(text))).details).toEqual({
      code: '131047',
      outcome: 'NOT_SENT',
      retryable: false,
      httpStatus: 400,
    });
    expect((await failure(provider().send(text))).details).toMatchObject({
      code: '130429',
      retryable: true,
      outcome: 'NOT_SENT',
    });
    // Envio com 5xx sem código conhecido: a Meta pode ter aceitado.
    expect((await failure(provider().send(text))).details).toMatchObject({
      code: '1',
      outcome: 'UNKNOWN',
      retryable: false,
    });
    // Leitura com o mesmo erro: só falhou.
    expect((await failure(provider().getPhoneHealth())).details.outcome).toBe('NOT_SENT');
  });

  it('tempo esgotado no envio é resultado incerto; na leitura, nova tentativa', async () => {
    replies = [
      { ...accepted(), delayMs: 1000 },
      { status: 200, body: {}, delayMs: 1000 },
    ];
    expect((await failure(provider().send(text))).details).toMatchObject({
      code: 'TIMEOUT',
      outcome: 'UNKNOWN',
      retryable: false,
    });
    expect((await failure(provider().getPhoneHealth())).details).toMatchObject({
      code: 'TIMEOUT',
      outcome: 'NOT_SENT',
      retryable: true,
    });
  });

  it('sem conexão: o pedido não saiu e pode ser repetido', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const error = await failure(provider({ baseUrl: `http://127.0.0.1:${port}` }).send(text));
    expect(error.details).toMatchObject({
      code: 'UNREACHABLE',
      outcome: 'NOT_SENT',
      retryable: true,
    });
  });

  it('resposta 2xx sem o id é resultado incerto; erros não expõem o token', async () => {
    replies = [{ status: 200, body: 'não é json' }];
    const error = await failure(provider().send(text));
    expect(error.details).toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'UNKNOWN' });
    expect(error.message).not.toContain(TOKEN);
  });

  it('lista os modelos com paginação, só seguindo links da própria Graph API', async () => {
    const tpl = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: `modelo_${id}`,
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá, {{1}}!' }],
      ...extra,
    });
    replies = [
      {
        status: 200,
        body: {
          data: [tpl('1', { quality_score: { score: 'GREEN' } })],
          paging: { next: `${baseUrl}/v26.0/100000000000001/message_templates?after=abc` },
        },
      },
      {
        status: 200,
        body: {
          data: [
            tpl('2', {
              category: 'utility',
              status: 'rejected',
              rejected_reason: 'INVALID_FORMAT',
              parameter_format: 'named',
            }),
          ],
          paging: { next: 'https://outro-host.example/v26.0/x' },
        },
      },
    ];
    const templates = await provider().listTemplates();
    expect(received.map((r) => r.url)).toEqual([
      expect.stringMatching(/^\/v26\.0\/100000000000001\/message_templates\?fields=.*&limit=100$/),
      '/v26.0/100000000000001/message_templates?after=abc',
    ]);
    expect(templates).toEqual([
      expect.objectContaining({
        metaTemplateId: '1',
        category: 'MARKETING',
        status: 'APPROVED',
        qualityScore: 'GREEN',
        rejectedReason: null,
        parameterFormat: 'POSITIONAL',
      }),
      expect.objectContaining({
        metaTemplateId: '2',
        category: 'UTILITY',
        status: 'REJECTED',
        rejectedReason: 'INVALID_FORMAT',
        parameterFormat: 'NAMED',
      }),
    ]);
  });

  it('lê a saúde do número', async () => {
    replies = [
      {
        status: 200,
        body: {
          display_phone_number: '+55 00 0000-0000',
          verified_name: 'Empresa Fictícia',
          quality_rating: 'GREEN',
          status: 'CONNECTED',
          name_status: 'APPROVED',
          whatsapp_business_manager_messaging_limit: 'TIER_2K',
          id: '200000000000002',
        },
      },
    ];
    expect(await provider().getPhoneHealth()).toEqual({
      displayPhoneNumber: '+55 00 0000-0000',
      verifiedName: 'Empresa Fictícia',
      qualityRating: 'GREEN',
      messagingLimit: 'TIER_2K',
      status: 'CONNECTED',
      nameStatus: 'APPROVED',
    });
    expect(received[0]!.url).toMatch(/^\/v26\.0\/200000000000002\?fields=/);
  });
});
