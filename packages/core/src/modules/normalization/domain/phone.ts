import { fail, ok, type Normalized } from './result';

/**
 * Normalização de telefones (docs/MVP.md M05; regras completas na Fase 3).
 *
 * Brasileiros viram E.164 (`+5588999999999`). Aceita máscara, prefixo `+55`/`0055`,
 * zero de longa distância com ou sem código de operadora e celular sem o 9º
 * dígito. Sem DDD, só normaliza se o DDD for informado pelo contexto (ex.: a
 * cidade do lead) e registra a inferência. Números de serviço (0800, 4004…)
 * são guardados só com dígitos.
 */

export type PhoneKind = 'MOBILE' | 'LANDLINE' | 'SERVICE' | 'UNKNOWN';

export type PhoneFlag =
  'ADDED_NINTH_DIGIT' | 'INFERRED_DDD' | 'REMOVED_CARRIER_CODE' | 'INTERNATIONAL';

export interface NormalizedPhone {
  /** E.164 para números comuns; só dígitos para números de serviço. */
  e164: string;
  kind: PhoneKind;
  /** DDD (só para números brasileiros comuns). */
  ddd: string | null;
  flags: PhoneFlag[];
}

/** DDDs em uso no Brasil (Anatel). */
export const BRAZIL_DDDS: ReadonlySet<string> = new Set([
  ...['11', '12', '13', '14', '15', '16', '17', '18', '19'],
  ...['21', '22', '24', '27', '28'],
  ...['31', '32', '33', '34', '35', '37', '38'],
  ...['41', '42', '43', '44', '45', '46', '47', '48', '49'],
  ...['51', '53', '54', '55'],
  ...['61', '62', '63', '64', '65', '66', '67', '68', '69'],
  ...['71', '73', '74', '75', '77', '79'],
  ...['81', '82', '83', '84', '85', '86', '87', '88', '89'],
  ...['91', '92', '93', '94', '95', '96', '97', '98', '99'],
]);

const SERVICE_PREFIXES = ['0800', '0300', '0500', '0900'];

export function normalizePhone(
  raw: string,
  options: { defaultDdd?: string | null } = {},
): Normalized<NormalizedPhone> {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return fail('EMPTY', 'Informe o telefone.');

  const flags: PhoneFlag[] = [];
  // Com "+" ou "00" o código do país é explícito.
  const explicitCountry = trimmed.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (explicitCountry && !digits.startsWith('55')) {
    if (digits.length < 8 || digits.length > 15) {
      return fail('INVALID_LENGTH', 'Telefone internacional com quantidade de dígitos inválida.');
    }
    return ok({ e164: `+${digits}`, kind: 'UNKNOWN', ddd: null, flags: ['INTERNATIONAL'] });
  }

  // Números de serviço não têm DDD nem formato E.164 utilizável.
  if (digits.length === 11 && SERVICE_PREFIXES.some((p) => digits.startsWith(p))) {
    return ok({ e164: digits, kind: 'SERVICE', ddd: null, flags });
  }
  if (digits.length === 8 && /^[34]00/.test(digits)) {
    return ok({ e164: digits, kind: 'SERVICE', ddd: null, flags });
  }

  let national = digits;
  if (explicitCountry) {
    national = national.slice(2);
  } else if ((national.length === 12 || national.length === 13) && national.startsWith('55')) {
    national = national.slice(2);
  } else if (national.startsWith('0')) {
    national = national.slice(1);
    if (national.length === 12 || national.length === 13) {
      // 0 + código da operadora (2 dígitos) + DDD + número.
      national = national.slice(2);
      flags.push('REMOVED_CARRIER_CODE');
    }
  }

  if (national.length === 8 || national.length === 9) {
    const ddd = options.defaultDdd?.trim();
    if (!ddd) return fail('MISSING_DDD', 'Informe o DDD do telefone.');
    national = ddd + national;
    flags.push('INFERRED_DDD');
  }

  if (national.length !== 10 && national.length !== 11) {
    return fail('INVALID_LENGTH', 'Telefone com quantidade de dígitos inválida.');
  }

  const ddd = national.slice(0, 2);
  if (!BRAZIL_DDDS.has(ddd)) return fail('INVALID_DDD', `DDD ${ddd} não existe.`);

  let subscriber = national.slice(2);
  let kind: PhoneKind;
  if (subscriber.length === 9) {
    if (!subscriber.startsWith('9')) {
      return fail('INVALID_NUMBER', 'Celular com 9 dígitos deve começar com 9.');
    }
    kind = 'MOBILE';
  } else if (/^[2-5]/.test(subscriber)) {
    kind = 'LANDLINE';
  } else if (/^[6-9]/.test(subscriber)) {
    // Celular gravado antes do 9º dígito (obrigatório em todo o país desde 2016).
    subscriber = `9${subscriber}`;
    kind = 'MOBILE';
    flags.push('ADDED_NINTH_DIGIT');
  } else {
    return fail('INVALID_NUMBER', 'Número de telefone inválido.');
  }

  return ok({ e164: `+55${ddd}${subscriber}`, kind, ddd, flags });
}

/** Exibição: "+5588999999999" → "(88) 99999-9999"; outros formatos voltam como estão. */
export function formatPhone(e164: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

/** Link do WhatsApp (modo assistido) para um número em E.164. */
export function whatsappLink(e164: string, text?: string): string | null {
  if (!e164.startsWith('+')) return null;
  const base = `https://wa.me/${e164.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Máscara para listas e auditoria: "+5588999999999" → "+55 88 9****-9999". */
export function maskPhone(e164: string): string {
  const match = /^\+55(\d{2})(\d)\d+(\d{4})$/.exec(e164);
  if (match) return `+55 ${match[1]} ${match[2]}****-${match[3]}`;
  return e164.length > 4 ? `${'*'.repeat(e164.length - 4)}${e164.slice(-4)}` : '****';
}
