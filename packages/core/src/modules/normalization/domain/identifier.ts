import { maskEmail } from '../../../shared/mask';
import { normalizeCnpj } from './cnpj';
import { normalizeEmail } from './email';
import { normalizeInstagram } from './instagram';
import { maskPhone, normalizePhone } from './phone';
import type { Normalized } from './result';

/** Identificadores que vão para a Lista Não Contatar. */
export type IdentifierKind = 'PHONE' | 'EMAIL' | 'INSTAGRAM' | 'CNPJ';

/** Valor normalizado de um identificador (a mesma forma usada no HMAC). */
export function normalizeIdentifier(kind: IdentifierKind, raw: string): Normalized<string> {
  switch (kind) {
    case 'PHONE': {
      const r = normalizePhone(raw);
      return r.ok ? { ok: true, value: r.value.e164 } : r;
    }
    case 'EMAIL': {
      const r = normalizeEmail(raw);
      return r.ok ? { ok: true, value: r.value.email } : r;
    }
    case 'INSTAGRAM': {
      const r = normalizeInstagram(raw);
      return r.ok ? { ok: true, value: r.value.handle } : r;
    }
    case 'CNPJ': {
      const r = normalizeCnpj(raw);
      return r.ok ? { ok: true, value: r.value.cnpj } : r;
    }
  }
}

/** Valor mascarado para listas, auditoria e eventos (nunca o valor em claro). */
export function maskIdentifier(kind: IdentifierKind, normalized: string): string {
  switch (kind) {
    case 'PHONE':
      return maskPhone(normalized);
    case 'EMAIL':
      return maskEmail(normalized);
    case 'INSTAGRAM':
      return `@${normalized.slice(0, 2)}***`;
    case 'CNPJ':
      return normalized.length === 14
        ? `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.***/****-${normalized.slice(12)}`
        : '**************';
  }
}
