import type { RequestMeta } from '@docline/core';
import { getIP } from 'better-auth/api';
import { randomUUID } from 'node:crypto';

export interface IpAddressOptions {
  ipAddressHeaders: string[];
  trustedProxies: string[];
}

/**
 * Como obter o IP do cliente (mesma configuração usada pelo Better Auth no
 * rate limit). Só o X-Forwarded-For é lido: com proxies confiáveis, a cadeia é
 * percorrida da direita para a esquerda até o primeiro salto não confiável;
 * sem eles, só um cabeçalho com um único IP é aceito. O primeiro item da cadeia
 * nunca é usado diretamente, porque o cliente pode forjá-lo.
 */
export function ipAddressOptions(trustedProxies: string[]): IpAddressOptions {
  return { ipAddressHeaders: ['x-forwarded-for'], trustedProxies };
}

/** Metadados da requisição para auditoria. */
export function requestMetaFrom(headers: Headers, ipOptions: IpAddressOptions): RequestMeta {
  const ip = getIP(headers, { advanced: { ipAddress: ipOptions } });
  return {
    requestId: headers.get('x-request-id') ?? randomUUID(),
    ip: ip ?? undefined,
    userAgent: headers.get('user-agent')?.slice(0, 300) || undefined,
  };
}
