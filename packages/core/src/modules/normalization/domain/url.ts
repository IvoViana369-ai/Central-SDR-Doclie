import { fail, ok, type Normalized } from './result';

export interface NormalizedUrl {
  /** URL com esquema, domínio em minúsculas e sem parâmetros de rastreio. */
  url: string;
  /** Domínio sem "www." (usado na deduplicação). */
  domain: string;
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid)$/i;

export function normalizeUrl(raw: string): Normalized<NormalizedUrl> {
  const value = raw.trim();
  if (value.length === 0) return fail('EMPTY', 'Informe o site.');
  if (/\s/.test(value)) return fail('INVALID_FORMAT', 'Site em formato inválido.');

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return fail('INVALID_FORMAT', 'Site em formato inválido.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('INVALID_SCHEME', 'O site deve começar com http:// ou https://.');
  }
  const host = parsed.hostname.toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return fail('INVALID_HOST', 'Domínio do site inválido.');
  }
  if (parsed.username || parsed.password) {
    return fail('INVALID_FORMAT', 'O site não pode conter usuário ou senha.');
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const search = parsed.searchParams.toString();
  const port = parsed.port ? `:${parsed.port}` : '';
  const url = `${parsed.protocol}//${host}${port}${path}${search ? `?${search}` : ''}`;
  return ok({ url, domain: host.replace(/^www\./, '') });
}
