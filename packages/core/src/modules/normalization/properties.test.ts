import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BRAZIL_DDDS,
  cnpjCheckDigits,
  formatCnpj,
  formatName,
  formatPhone,
  nameCore,
  normalizeCnpj,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizePostalCode,
  normalizeUf,
  normalizeUrl,
  parseCityState,
  splitList,
  toSearchKey,
} from './index';

/**
 * Testes de propriedade (docs/ARCHITECTURE.md §12.1): idempotência,
 * equivalência de formatos e nunca lançar exceção, para qualquer entrada.
 */
const RUNS = { numRuns: 300, seed: 20261009 };

const ddd = fc.constantFrom(...BRAZIL_DDDS);
const digits = (length: number) =>
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: length, maxLength: length })
    .map((d) => d.join(''));
/** Celular brasileiro: DDD + 9 + 8 dígitos. */
const mobile = fc.tuple(ddd, digits(8)).map(([d, rest]) => ({ ddd: d, number: `9${rest}` }));
/** Fixo: DDD + [2-5] + 7 dígitos. */
const landline = fc
  .tuple(ddd, fc.integer({ min: 2, max: 5 }), digits(7))
  .map(([d, first, rest]) => ({ ddd: d, number: `${first}${rest}` }));

describe('propriedades da normalização', () => {
  it('nenhuma função lança exceção, qualquer que seja o texto', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => {
        normalizePhone(text);
        normalizePhone(text, { defaultDdd: '88' });
        normalizeEmail(text);
        normalizeCnpj(text);
        normalizeInstagram(text);
        normalizeUrl(text);
        normalizePostalCode(text);
        normalizeUf(text);
        parseCityState(text);
        splitList(text, { slash: true });
        formatName(text);
        nameCore(text);
      }),
      RUNS,
    );
  });

  it('telefone: todos os formatos do mesmo número dão o mesmo E.164', () => {
    fc.assert(
      fc.property(fc.oneof(mobile, landline), ({ ddd: d, number }) => {
        const head = number.slice(0, number.length - 4);
        const tail = number.slice(-4);
        const formats = [
          `(${d}) ${head}-${tail}`,
          `${d}${number}`,
          `+55 ${d} ${head}-${tail}`,
          `055 ${d} ${number}`,
          `0xx${d} ${head} ${tail}`,
          `55${d}${number}`,
        ];
        const results = formats.map((f) => normalizePhone(f));
        for (const r of results) expect(r.ok).toBe(true);
        const e164 = new Set(results.map((r) => (r.ok ? r.value.e164 : '')));
        expect(e164).toEqual(new Set([`+55${d}${number}`]));
      }),
      RUNS,
    );
  });

  it('telefone: normalizar o valor formatado devolve o mesmo valor (idempotência)', () => {
    fc.assert(
      fc.property(fc.oneof(mobile, landline), ({ ddd: d, number }) => {
        const first = normalizePhone(`${d}${number}`);
        if (!first.ok) throw new Error(first.reason);
        for (const again of [first.value.e164, formatPhone(first.value.e164)]) {
          const second = normalizePhone(again);
          expect(second.ok && second.value.e164).toBe(first.value.e164);
        }
      }),
      RUNS,
    );
  });

  it('CNPJ: qualquer base com DV calculado é válido, com ou sem máscara', () => {
    const base = fc
      .array(fc.constantFrom(...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'), {
        minLength: 12,
        maxLength: 12,
      })
      .map((chars) => chars.join(''))
      .filter((b) => !/^(.)\1+$/.test(b));
    fc.assert(
      fc.property(base, (b) => {
        const cnpj = `${b}${cnpjCheckDigits(b)}`;
        const plain = normalizeCnpj(cnpj);
        const masked = normalizeCnpj(formatCnpj(cnpj).toLowerCase());
        expect(plain.ok && plain.value.cnpj).toBe(cnpj);
        expect(masked.ok && masked.value.cnpj).toBe(cnpj);
      }),
      RUNS,
    );
  });

  it('nomes e chaves de busca são idempotentes', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        expect(formatName(formatName(text))).toBe(formatName(text));
        expect(toSearchKey(toSearchKey(text))).toBe(toSearchKey(text));
      }),
      RUNS,
    );
  });

  it('e-mail normalizado continua o mesmo ao normalizar de novo', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const first = normalizeEmail(email.toUpperCase());
        if (!first.ok) return;
        const second = normalizeEmail(first.value.email);
        expect(second.ok && second.value.email).toBe(first.value.email);
      }),
      RUNS,
    );
  });
});
