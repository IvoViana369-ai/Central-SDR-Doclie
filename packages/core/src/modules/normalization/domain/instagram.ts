import { fail, ok, type Normalized } from './result';

export interface NormalizedInstagram {
  /** Usuário sem "@", em minúsculas. */
  handle: string;
  url: string;
}

/** Caminhos do Instagram que não são perfis. */
const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct']);

const HANDLE = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;

/** Aceita "@usuario", "usuario" ou a URL do perfil (com ou sem parâmetros). */
export function normalizeInstagram(raw: string): Normalized<NormalizedInstagram> {
  let value = raw.trim();
  if (value.length === 0) return fail('EMPTY', 'Informe o Instagram.');

  const fromUrl = /(?:^|\/\/|\.)instagram\.com\/+([^/?#\s]+)/i.exec(value);
  if (fromUrl) {
    value = fromUrl[1]!;
  } else if (/[/\s]/.test(value)) {
    return fail('INVALID_FORMAT', 'Informe o usuário (@perfil) ou o link do perfil.');
  }

  const handle = value.replace(/^@+/, '').toLowerCase();
  if (RESERVED.has(handle)) {
    return fail('NOT_A_PROFILE', 'O link não é de um perfil do Instagram.');
  }
  if (!HANDLE.test(handle)) return fail('INVALID_FORMAT', 'Usuário do Instagram inválido.');
  return ok({ handle, url: `https://www.instagram.com/${handle}/` });
}
