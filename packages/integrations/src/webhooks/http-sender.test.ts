import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebhookTransportError } from '@docline/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpWebhookSender } from './http-sender';

/** Receptor local fictício: responde conforme o caminho. */
let server: Server;
let base: string;
const received: { headers: IncomingMessage['headers']; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
      } else if (req.url === '/slow') {
        setTimeout(() => res.writeHead(200).end('tarde'), 1_000);
      } else if (req.url === '/big') {
        res.writeHead(500).end('x'.repeat(100_000));
      } else {
        res.writeHead(200, { 'set-cookie': 'sessao=1' }).end('{"ok":true}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const DEV = new HttpWebhookSender({ allowPrivateNetworks: true });
const PROD = new HttpWebhookSender({ allowPrivateNetworks: false });
const request = (url: string, timeoutMs = 2_000) => ({
  url,
  headers: { 'content-type': 'application/json', 'docline-signature': 't=1,v1=abc' },
  body: '{"id":"evt-1"}',
  timeoutMs,
});

describe('envio HTTP de webhooks (SSRF, docs/SECURITY.md §10)', () => {
  it('envia o POST com corpo e cabeçalhos e devolve o status', async () => {
    const response = await DEV.send(request(`${base}/hook`));
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    const last = received.at(-1)!;
    expect(last.body).toBe('{"id":"evt-1"}');
    expect(last.headers['docline-signature']).toBe('t=1,v1=abc');
    expect(last.headers['content-length']).toBe('14');
    expect(last.headers.cookie).toBeUndefined();
  });

  it('em produção recusa IP interno literal e nome que resolve para rede interna', async () => {
    const before = received.length;
    await expect(PROD.send(request(`${base}/hook`))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const port = (server.address() as AddressInfo).port;
    const error = await PROD.send(request(`http://localhost:${port}/hook`)).catch((e) => e);
    expect(error).toBeInstanceOf(WebhookTransportError);
    expect((error as WebhookTransportError).code).toBe('BLOCKED');
    expect((error as Error).message).toMatch(/loopback/);
    expect(received.length).toBe(before);
  });

  it('não segue redirecionamento (nem para os metadados da nuvem)', async () => {
    const response = await DEV.send(request(`${base}/redirect`));
    expect(response.status).toBe(302);
  });

  it('corta pelo tempo e lê só o começo da resposta', async () => {
    await expect(DEV.send(request(`${base}/slow`, 200))).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    const big = await DEV.send(request(`${base}/big`));
    expect(big.status).toBe(500);
    expect(big.body.length).toBeLessThanOrEqual(2048);
  });

  it('nome inexistente vira erro de DNS', async () => {
    await expect(DEV.send(request('http://nao-existe.invalid/hook', 2_000))).rejects.toBeInstanceOf(
      WebhookTransportError,
    );
  });
});
