import { fail, ok, type Normalized } from './result';

export interface NormalizedEmail {
  /** Endereço em minúsculas, sem espaços nem `mailto:`. */
  email: string;
  domain: string;
  /** Provedor gratuito (Gmail, Hotmail…): indica e-mail pessoal, não corporativo. */
  isFreeProvider: boolean;
}

const FREE_PROVIDERS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.br',
  'outlook.com',
  'outlook.com.br',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'globomail.com',
  'zipmail.com.br',
  'proton.me',
  'protonmail.com',
]);

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeEmail(raw: string): Normalized<NormalizedEmail> {
  const email = raw
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase();
  if (email.length === 0) return fail('EMPTY', 'Informe o e-mail.');
  if (email.length > 254) return fail('TOO_LONG', 'E-mail longo demais.');

  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (at <= 0 || local.length > 64 || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) {
    return fail('INVALID_FORMAT', 'E-mail em formato inválido.');
  }
  return ok({ email, domain, isFreeProvider: FREE_PROVIDERS.has(domain) });
}
