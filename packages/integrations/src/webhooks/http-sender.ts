import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  checkAddress,
  isIpLiteral,
  WebhookTransportError,
  type NetworkPolicy,
  type WebhookRequest,
  type WebhookResponse,
  type WebhookSender,
} from '@docline/core';

const MAX_RESPONSE_BYTES = 2048;

/**
 * Resolve o nome e recusa se QUALQUER endereço cair numa faixa bloqueada; o
 * socket conecta no endereço aprovado aqui (sem segunda consulta ao DNS, o que
 * fecha a porta para DNS rebinding). docs/SECURITY.md §10.
 */
export function guardedLookup(policy: NetworkPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true, family: options.family }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      const list = addresses as LookupAddress[];
      const blocked = list.find((a) => !checkAddress(a.address, policy).ok);
      if (blocked || list.length === 0) {
        const reason = blocked ? checkAddress(blocked.address, policy) : null;
        const err = Object.assign(
          new Error(
            `Endereço bloqueado: ${hostname} resolve para ${blocked?.address ?? 'nada'}${
              reason && !reason.ok ? ` (${reason.reason})` : ''
            }.`,
          ),
          { code: 'EBLOCKED' },
        );
        return callback(err, '', 4);
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

/**
 * Envio real de webhooks (F12-02): um POST, sem seguir redirecionamentos, sem
 * cookies, com tempo máximo e lendo só os primeiros 2 KB da resposta.
 */
export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly policy: NetworkPolicy) {}

  send(request: WebhookRequest): Promise<WebhookResponse> {
    const started = Date.now();
    const url = new URL(request.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // IP literal não passa pelo DNS: confere aqui.
    if (isIpLiteral(host)) {
      const check = checkAddress(host, this.policy);
      if (!check.ok) {
        return Promise.reject(
          new WebhookTransportError(`Endereço bloqueado (${check.reason}).`, 'BLOCKED'),
        );
      }
    }
    const client = url.protocol === 'https:' ? https : http;
    return new Promise<WebhookResponse>((resolve, reject) => {
      const timeoutError = () =>
        new WebhookTransportError(
          `Sem resposta em ${Math.round(request.timeoutMs / 1000)} s.`,
          'TIMEOUT',
        );
      // Prazo total (DNS, conexão, envio e leitura), além do de ociosidade do socket.
      const deadline = setTimeout(() => req.destroy(timeoutError()), request.timeoutMs);
      const finish =
        <T>(settle: (value: T) => void) =>
        (value: T) => {
          clearTimeout(deadline);
          settle(value);
        };
      resolve = finish(resolve);
      reject = finish(reject);
      const req = client.request(
        url,
        {
          method: 'POST',
          headers: {
            ...request.headers,
            'content-length': String(Buffer.byteLength(request.body)),
          },
          lookup: guardedLookup(this.policy),
          timeout: request.timeoutMs,
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            if (size < MAX_RESPONSE_BYTES) chunks.push(chunk);
            size += chunk.length;
            if (size >= MAX_RESPONSE_BYTES) res.destroy();
          });
          const done = () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES),
              durationMs: Date.now() - started,
            });
          res.on('end', done);
          res.on('close', done);
          res.on('error', done);
        },
      );
      req.on('timeout', () => req.destroy(timeoutError()));
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error instanceof WebhookTransportError) return reject(error);
        if (error.code === 'EBLOCKED') {
          return reject(new WebhookTransportError(error.message, 'BLOCKED'));
        }
        if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          return reject(new WebhookTransportError(`Nome não encontrado: ${host}.`, 'DNS'));
        }
        reject(
          new WebhookTransportError(
            `Falha de conexão (${error.code ?? error.message}).`,
            'NETWORK',
          ),
        );
      });
      req.end(request.body);
    });
  }
}
