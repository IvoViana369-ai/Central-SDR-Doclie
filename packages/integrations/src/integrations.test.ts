import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { parseServerEnv } from '@docline/config';
import { describe, expect, it, vi } from 'vitest';
import { FileEmailProvider } from './email/file';
import { ResendEmailProvider } from './email/resend';
import { createLogger } from './observability/logger';
import {
  assertProvidersImplemented,
  createEmailProvider,
  createWhatsappProvider,
  integrationStatuses,
  whatsappWebhookConfig,
} from './registry';

const baseEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  SUPPRESSION_HASH_PEPPER: 'y'.repeat(40),
};
const email = {
  to: 'ana@example.com',
  subject: 'Assunto',
  text: 'Texto',
  html: '<p>Texto</p>',
  category: 'invitation' as const,
};

describe('logger', () => {
  it('mascara credenciais e dados de contato', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger({ service: 'web', destination });
    logger.info(
      {
        user: { email: 'ana@example.com', password: 'segredo' },
        token: 'abc',
        headers: { cookie: 'sid=1' },
      },
      'teste',
    );
    const entry = JSON.parse(lines[0]!);
    expect(entry.user).toEqual({ email: '[REDACTED]', password: '[REDACTED]' });
    expect(entry.token).toBe('[REDACTED]');
    expect(entry.headers.cookie).toBe('[REDACTED]');
    expect(entry).toMatchObject({ service: 'web', level: 'info', msg: 'teste' });
    expect(lines[0]).not.toContain('ana@example.com');
  });
});

describe('provedores de e-mail', () => {
  it('file grava um JSON por linha', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'sub', 'outbox.jsonl');
    const provider = new FileEmailProvider(path);
    await provider.send(email);
    await provider.send({ ...email, subject: 'Segundo' });
    const rows = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(rows.map((r) => r.subject)).toEqual(['Assunto', 'Segundo']);
  });

  it('resend chama a API com autenticação e falha em erro HTTP', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    await new ResendEmailProvider('re_key', 'Docline <a@b.com>', fetchMock as typeof fetch).send(
      email,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ['ana@example.com'],
      subject: 'Assunto',
    });

    const failing = vi.fn(async () => new Response('erro', { status: 500 }));
    await expect(
      new ResendEmailProvider('k', 'f', failing as typeof fetch).send(email),
    ).rejects.toThrow(/500/);
  });

  it('o registro escolhe o provedor configurado', () => {
    const logger = createLogger({ service: 'web', level: 'silent' });
    expect(createEmailProvider(parseServerEnv(baseEnv), logger).name).toBe('console');
    expect(
      createEmailProvider(parseServerEnv({ ...baseEnv, EMAIL_PROVIDER: 'file' }), logger).name,
    ).toBe('file');
    expect(
      createEmailProvider(
        parseServerEnv({ ...baseEnv, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://localhost:1025' }),
        logger,
      ).name,
    ).toBe('smtp');
  });
});

describe('status das integrações', () => {
  it('no padrão, canais ficam em modo assistido e o resto simulado ou desligado', () => {
    const statuses = Object.fromEntries(
      integrationStatuses(parseServerEnv(baseEnv)).map((s) => [s.key, s.state]),
    );
    expect(statuses).toEqual({
      whatsapp: 'assisted',
      instagram: 'assisted',
      places: 'disabled',
      companyRegistry: 'disabled',
      ai: 'simulated',
      email: 'simulated',
      crm: 'disabled',
      errors: 'disabled',
    });
    expect(() => assertProvidersImplemented(parseServerEnv(baseEnv))).not.toThrow();
  });

  it('monitoramento de erros fica ativo com o DSN do Sentry', () => {
    const env = parseServerEnv({ ...baseEnv, SENTRY_DSN: 'https://chave@o1.ingest.sentry.io/1' });
    expect(integrationStatuses(env).find((s) => s.key === 'errors')).toMatchObject({
      provider: 'sentry',
      state: 'active',
    });
    expect(() => assertProvidersImplemented(env)).not.toThrow();
  });

  it('falha na inicialização se um provedor de fase futura for configurado', () => {
    const env = parseServerEnv({
      ...baseEnv,
      INSTAGRAM_PROVIDER: 'meta_graph',
      META_APP_SECRET: 's',
      META_ACCESS_TOKEN: 't',
      META_GRAPH_API_VERSION: 'v26.0',
      INSTAGRAM_BUSINESS_ACCOUNT_ID: '1',
    });
    expect(() => assertProvidersImplemented(env)).toThrow(
      /Instagram="meta_graph" \(previsto para a Fase 8\)/,
    );
  });

  it('WhatsApp: assistido sem provedor; simulado; Cloud API ativa (Fase 7)', () => {
    expect(createWhatsappProvider(parseServerEnv(baseEnv))).toBeNull();
    expect(whatsappWebhookConfig(parseServerEnv(baseEnv))).toBeNull();

    const fake = parseServerEnv({ ...baseEnv, WHATSAPP_PROVIDER: 'fake' });
    expect(createWhatsappProvider(fake)?.name).toBe('fake');
    // Simulado sem segredos: o endpoint de webhooks não aceita nada.
    expect(whatsappWebhookConfig(fake)).toBeNull();
    expect(
      whatsappWebhookConfig(
        parseServerEnv({
          ...baseEnv,
          WHATSAPP_PROVIDER: 'fake',
          META_APP_SECRET: 'segredo-de-teste',
          META_WEBHOOK_VERIFY_TOKEN: 'verificacao-de-teste',
        }),
      ),
    ).toEqual({ appSecret: 'segredo-de-teste', verifyToken: 'verificacao-de-teste' });

    const cloud = parseServerEnv({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'meta_cloud',
      META_APP_SECRET: 's',
      META_ACCESS_TOKEN: 't',
      META_GRAPH_API_VERSION: 'v26.0',
      META_WEBHOOK_VERIFY_TOKEN: 'v',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '1',
      WHATSAPP_PHONE_NUMBER_ID: '2',
    });
    expect(() => assertProvidersImplemented(cloud)).not.toThrow();
    expect(createWhatsappProvider(cloud)?.name).toBe('meta_cloud');
    expect(integrationStatuses(cloud).find((s) => s.key === 'whatsapp')?.state).toBe('active');
  });
});
