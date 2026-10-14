import type { RequestMeta } from '@docline/core';
import { getIP } from 'better-auth/api';
import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

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

/** Faixas privadas comuns aos proxies internos das hospedagens. */
const PRIVATE_RANGES: { cidr: string; network: string; prefix: number; family: 'ipv4' | 'ipv6' }[] =
  [
    { cidr: '10.0.0.0/8', network: '10.0.0.0', prefix: 8, family: 'ipv4' },
    { cidr: '172.16.0.0/12', network: '172.16.0.0', prefix: 12, family: 'ipv4' },
    { cidr: '192.168.0.0/16', network: '192.168.0.0', prefix: 16, family: 'ipv4' },
    { cidr: '100.64.0.0/10', network: '100.64.0.0', prefix: 10, family: 'ipv4' },
    { cidr: 'fc00::/7', network: 'fc00::', prefix: 7, family: 'ipv6' },
  ];

function privateRangeOf(ip: string): string | null {
  const version = isIP(ip);
  if (version === 0) return null;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  for (const range of PRIVATE_RANGES) {
    if (range.family !== family) continue;
    const list = new BlockList();
    list.addSubnet(range.network, range.prefix, family);
    if (list.check(ip, family)) return range.cidr;
  }
  return null;
}

export interface ForwardingReport {
  /** X-Forwarded-For recebido, da esquerda (cliente) para a direita (último proxy). */
  forwardedFor: string[];
  /** IP que o sistema usa na auditoria e no limite de login (null = indefinido). */
  resolvedIp: string | null;
  trustedProxies: string[];
  ok: boolean;
  /** Valor sugerido para TRUSTED_PROXIES quando o IP fica indefinido. */
  suggestedTrustedProxies: string | null;
  message: string;
}

/**
 * Diagnóstico do primeiro deploy (docs/SECURITY.md §12): o que a hospedagem
 * entrega no X-Forwarded-For e o IP que o sistema extrai. Só sugere faixas
 * privadas para os saltos depois do primeiro; IP público na cadeia pede
 * conferência humana, porque confiar nele permitiria forjar o IP do cliente.
 */
export function forwardingReport(headers: Headers, ipOptions: IpAddressOptions): ForwardingReport {
  const forwardedFor = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const ip = requestMetaFrom(headers, ipOptions).ip ?? null;
  // Em desenvolvimento e testes o Better Auth devolve 127.0.0.1 quando não
  // resolve; em staging e produção devolve null.
  const resolvedIp = ip && (ip !== '127.0.0.1' || forwardedFor.includes(ip)) ? ip : null;
  const base = { forwardedFor, resolvedIp, trustedProxies: ipOptions.trustedProxies };

  if (resolvedIp) {
    return {
      ...base,
      ok: true,
      suggestedTrustedProxies: null,
      message:
        forwardedFor.length > 1
          ? 'IP do cliente identificado com os proxies configurados. Nada a mudar.'
          : 'A hospedagem entrega um único IP. Nada a configurar agora.',
    };
  }
  if (forwardedFor.length === 0) {
    return {
      ...base,
      ok: false,
      suggestedTrustedProxies: null,
      message: 'Nenhum X-Forwarded-For recebido. Abra este endereço pela URL pública do sistema.',
    };
  }
  const hops = forwardedFor.slice(1);
  if (hops.length === 0) {
    return {
      ...base,
      ok: false,
      suggestedTrustedProxies: null,
      message:
        'O X-Forwarded-For recebido não é um IP válido. Envie este resultado ao suporte técnico.',
    };
  }
  const ranges = hops.map(privateRangeOf);
  if (ranges.every((range) => range !== null)) {
    const suggestion = [...new Set([...ipOptions.trustedProxies, ...ranges])].join(',');
    return {
      ...base,
      ok: false,
      suggestedTrustedProxies: suggestion,
      message: `IP indefinido: todos dividem o mesmo limite de login. Defina TRUSTED_PROXIES=${suggestion} e confira de novo.`,
    };
  }
  return {
    ...base,
    ok: false,
    suggestedTrustedProxies: null,
    message:
      'IP indefinido e a cadeia tem IP público depois do primeiro item. Envie este resultado ao suporte técnico antes de configurar TRUSTED_PROXIES.',
  };
}
