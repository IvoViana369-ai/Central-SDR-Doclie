/**
 * Proteção contra SSRF nos webhooks de saída (docs/SECURITY.md §10).
 *
 * Duas camadas: a URL é conferida ao cadastrar (esquema, credenciais, host
 * literal) e cada endereço resolvido pelo DNS é conferido de novo na hora do
 * envio, no próprio socket (o adaptador conecta no IP aprovado; sem seguir
 * redirecionamentos). Sem dependência de Node: também serve aos formulários.
 */

export const WEBHOOK_URL_MAX_LENGTH = 2048;

export interface NetworkPolicy {
  /** Rede interna (localhost, 10/8, 192.168/16…) só em desenvolvimento e testes. */
  allowPrivateNetworks: boolean;
}

/** Faixas que nunca recebem webhooks em produção (IPv4: [rede, prefixo]). */
const BLOCKED_V4: [string, number, string][] = [
  ['0.0.0.0', 8, 'rede "esta rede"'],
  ['10.0.0.0', 8, 'rede privada'],
  ['100.64.0.0', 10, 'rede compartilhada (CGNAT)'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local (inclui metadados de nuvem)'],
  ['172.16.0.0', 12, 'rede privada'],
  ['192.0.0.0', 24, 'reservado (IETF)'],
  ['192.0.2.0', 24, 'documentação'],
  ['192.88.99.0', 24, 'reservado (6to4)'],
  ['192.168.0.0', 16, 'rede privada'],
  ['198.18.0.0', 15, 'testes de desempenho'],
  ['198.51.100.0', 24, 'documentação'],
  ['203.0.113.0', 24, 'documentação'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reservado'],
];

/** Faixas IPv6 bloqueadas: [rede, prefixo, motivo]. */
const BLOCKED_V6: [string, number, string][] = [
  ['::', 128, 'endereço não especificado'],
  ['::1', 128, 'loopback'],
  ['100::', 64, 'descarte'],
  ['2001::', 32, 'Teredo'],
  ['2001:db8::', 32, 'documentação'],
  ['2002::', 16, '6to4'],
  ['fc00::', 7, 'rede privada (ULA)'],
  ['fe80::', 10, 'link-local'],
  ['ff00::', 8, 'multicast'],
];

/** Nomes que apontam para a própria máquina ou para a rede interna. */
const INTERNAL_HOSTNAMES = [/^localhost$/, /\.localhost$/, /\.local$/, /\.internal$/, /\.lan$/];

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null;
}

/** IPv6 em 16 bytes (aceita "::" e IPv4 embutido no fim). */
function parseV6(input: string): number[] | null {
  const ip = input
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!
    .toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(ip) || !ip.includes(':')) return null;
  let tail: number[] = [];
  let head = ip;
  const lastColon = ip.lastIndexOf(':');
  if (ip.slice(lastColon + 1).includes('.')) {
    const v4 = parseV4(ip.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    head = ip.slice(0, lastColon + 1) + '0:0';
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const left = groups(halves[0]!);
  const right = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return null;
  const all = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function inPrefix(bytes: number[], network: number[], prefix: number): boolean {
  for (let bit = 0; bit < prefix; bit += 1) {
    const i = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if ((bytes[i]! & mask) !== (network[i]! & mask)) return false;
  }
  return true;
}

export type AddressCheck = { ok: true } | { ok: false; reason: string };

/** O endereço IP pode receber webhooks? (IPv4 ou IPv6, inclusive IPv4 embutido.) */
export function checkAddress(ip: string, policy: NetworkPolicy): AddressCheck {
  const v4 = parseV4(ip);
  const v6 = v4 ? null : parseV6(ip);
  if (!v4 && !v6) return { ok: false, reason: 'endereço IP inválido' };
  if (policy.allowPrivateNetworks) return { ok: true };
  if (v6) {
    // IPv4 mapeado (::ffff:a.b.c.d) ou NAT64 (64:ff9b::a.b.c.d): vale a regra do IPv4.
    const mapped = inPrefix(v6, parseV6('::ffff:0:0')!, 96);
    const nat64 = inPrefix(v6, parseV6('64:ff9b::')!, 96);
    if (mapped || nat64) return checkAddress(v6.slice(12).join('.'), policy);
    for (const [network, prefix, reason] of BLOCKED_V6) {
      if (inPrefix(v6, parseV6(network)!, prefix)) return { ok: false, reason };
    }
    return { ok: true };
  }
  for (const [network, prefix, reason] of BLOCKED_V4) {
    if (inPrefix(v4!, parseV4(network)!, prefix)) return { ok: false, reason };
  }
  if (v4!.every((b) => b === 255)) return { ok: false, reason: 'broadcast' };
  return { ok: true };
}

export function isIpLiteral(host: string): boolean {
  return parseV4(host) !== null || parseV6(host) !== null;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

/**
 * Confere a URL de um destino de webhook no cadastro: https (http só com rede
 * interna liberada), sem usuário/senha, sem fragmento, host público.
 */
export function validateWebhookUrl(raw: string, policy: NetworkPolicy): UrlCheck {
  const value = raw.trim();
  if (value.length > WEBHOOK_URL_MAX_LENGTH) {
    return { ok: false, message: `A URL pode ter até ${WEBHOOK_URL_MAX_LENGTH} caracteres.` };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'URL inválida.' };
  }
  if (url.protocol !== 'https:' && !(policy.allowPrivateNetworks && url.protocol === 'http:')) {
    return { ok: false, message: 'Use uma URL https://.' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'Não coloque usuário ou senha na URL.' };
  }
  if (url.hash) return { ok: false, message: 'Tire o fragmento (#…) da URL.' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, message: 'URL sem endereço.' };
  if (isIpLiteral(host)) {
    const check = checkAddress(host, policy);
    if (!check.ok) return { ok: false, message: `Endereço não permitido (${check.reason}).` };
  } else if (!policy.allowPrivateNetworks) {
    if (INTERNAL_HOSTNAMES.some((re) => re.test(host)) || !host.includes('.')) {
      return { ok: false, message: 'Endereço interno não permitido.' };
    }
  }
  return { ok: true, url };
}
