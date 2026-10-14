import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';
import { createErrorReporter, scrubText } from './error-reporter';

describe('envio de erros (Sentry)', () => {
  afterAll(() => Sentry.close());

  it('troca e-mails e números longos por marcadores', () => {
    expect(scrubText('Key (email)=(fulano@exemplo.com) already exists')).toBe(
      'Key (email)=([e-mail]) already exists',
    );
    expect(scrubText('telefone (88) 99999-1234 e CNPJ 12.345.678/0001-95')).toBe(
      'telefone [número] e CNPJ [número]',
    );
    expect(scrubText('+5588999991234')).toBe('[número]');
    // Números curtos (códigos, contagens) ficam.
    expect(scrubText('Lead L-000123 falhou após 3 tentativas em 2026')).toBe(
      'Lead L-000123 falhou após 3 tentativas em 2026',
    );
  });

  it('sem DSN, não envia nada', () => {
    const reporter = createErrorReporter({ dsn: undefined, environment: 'test', service: 'web' });
    expect(reporter.enabled).toBe(false);
    expect(() => reporter.capture(new Error('x'))).not.toThrow();
  });

  it('com DSN, envia o erro com o contexto e sem dados pessoais', async () => {
    const received: string[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push(`${req.url}\n${body}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const reporter = createErrorReporter({
      dsn: `http://chavepublica@127.0.0.1:${port}/1`,
      environment: 'test',
      service: 'web',
    });
    expect(reporter.enabled).toBe(true);
    reporter.capture(
      new Error('Falha ao salvar fulano@exemplo.com com telefone (88) 99999-1234', {
        cause: new Error('detalhe com outro@exemplo.com'),
      }),
      { requestId: 'req-123', route: '/api/v1/leads' },
    );
    await reporter.flush(5_000);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const body = received.join('\n');
    expect(body).toContain('/api/1/envelope/');
    expect(body).toContain('req-123');
    expect(body).toContain('/api/v1/leads');
    expect(body).toContain('Falha ao salvar [e-mail] com telefone [número]');
    expect(body).not.toContain('fulano@');
    expect(body).not.toContain('outro@');
    expect(body).not.toContain('99999');
  });
});
