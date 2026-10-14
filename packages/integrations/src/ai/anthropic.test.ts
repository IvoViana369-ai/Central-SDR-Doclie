import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AiProviderError, outreachMessageSchema } from '@docline/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicAiProvider } from './anthropic';

/** Servidor local que imita a Messages API: sem rede, sem custo. */
let server: Server;
let baseURL = '';
let next: { status: number; body: unknown } = { status: 200, body: {} };
let received: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null;

const OUTPUT = {
  message: 'Olá, Carlos! Sou a Ana, da Docline.',
  personalizationPoints: ['Carlos'],
  factsUsed: [],
  assumptions: [],
  missingInfo: [],
  tone: 'cordial',
  confidence: 'high',
};

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_teste',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(OUTPUT) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 1200,
    output_tokens: 300,
    cache_read_input_tokens: 800,
    cache_creation_input_tokens: 0,
  },
  ...overrides,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(raw || '{}') };
      res.writeHead(next.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  received = null;
});

const provider = () =>
  new AnthropicAiProvider({
    apiKey: 'chave-de-teste-nao-real',
    model: 'claude-opus-5-5',
    classificationModel: 'claude-opus-5-5',
    baseURL,
    maxRetries: 0,
  });

const request = {
  task: 'outreach_message' as const,
  system: 'Sistema estável.',
  input: '<pedido>Tipo de mensagem: Primeiro contato</pedido>',
  schema: outreachMessageSchema,
  effort: 'medium' as const,
  maxOutputTokens: 16000,
};

describe('AnthropicAiProvider', () => {
  it('pede saída estruturada, esforço, cache no sistema e fallback de recusa', async () => {
    next = { status: 200, body: message() };
    const result = await provider().generateStructured(request);
    expect(result).toMatchObject({
      data: OUTPUT,
      model: 'claude-opus-5-5',
      stopReason: 'end_turn',
      fallbackUsed: false,
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 },
    });
    expect(received!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(received!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default',
      system: [{ type: 'text', text: 'Sistema estável.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request.input }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(received!.body).not.toHaveProperty('thinking');
  });

  it('recusa, corte por tamanho e saída fora do schema viram erros do domínio', async () => {
    const expectCode = async (code: string, retryable: boolean) => {
      const error = await provider()
        .generateStructured(request)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiProviderError);
      expect(error).toMatchObject({ code, retryable });
    };
    next = { status: 200, body: message({ stop_reason: 'refusal', content: [] }) };
    await expectCode('REFUSAL', false);
    next = { status: 200, body: message({ stop_reason: 'max_tokens' }) };
    await expectCode('MAX_TOKENS', false);
    next = {
      status: 200,
      body: message({ content: [{ type: 'text', text: '{"message": 42}' }] }),
    };
    await expectCode('INVALID_OUTPUT', true);
    next = {
      status: 429,
      body: { type: 'error', error: { type: 'rate_limit_error', message: 'x' } },
    };
    await expectCode('RATE_LIMITED', true);
    next = {
      status: 401,
      body: { type: 'error', error: { type: 'authentication_error', message: 'x' } },
    };
    await expectCode('AUTH', false);
  });

  it('marca quando outro modelo atendeu pelo fallback', async () => {
    next = {
      status: 200,
      body: message({
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 10,
          output_tokens: 10,
          iterations: [{ type: 'fallback_message', input_tokens: 10, output_tokens: 10 }],
        },
      }),
    };
    expect(await provider().generateStructured(request)).toMatchObject({
      model: 'claude-opus-4-8',
      fallbackUsed: true,
    });
  });
});
