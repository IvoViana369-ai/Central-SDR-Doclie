import { describe, expect, it } from 'vitest';
import {
  normalizeCnpj,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizeUrl,
} from '../modules/normalization';
import { FAKE_EMAIL_DOMAIN, generateFakeLeads, type FakeMunicipality } from './fake-leads';

const municipalities: FakeMunicipality[] = [
  { ibgeCode: 2304400, uf: 'CE', ddd: 85, isCapital: true },
  { ibgeCode: 2312908, uf: 'CE', ddd: 88, isCapital: false },
  { ibgeCode: 3550308, uf: 'SP', ddd: 11, isCapital: true },
  { ibgeCode: 3509502, uf: 'SP', ddd: 19, isCapital: false },
];
const sources = [
  {
    id: '0190a1b2-0000-7000-8000-000000000001',
    key: 'GOOGLE',
    defaultLegalBasis: 'LEGITIMATE_INTEREST' as const,
  },
  {
    id: '0190a1b2-0000-7000-8000-000000000002',
    key: 'REFERRAL',
    defaultLegalBasis: 'LEGITIMATE_INTEREST' as const,
  },
  {
    id: '0190a1b2-0000-7000-8000-000000000003',
    key: 'EVENT',
    defaultLegalBasis: 'NOT_ASSESSED' as const,
  },
];
const generate = (seed = 42, count = 2000) =>
  generateFakeLeads({
    count,
    seed,
    now: new Date('2026-10-09T12:00:00Z'),
    municipalities,
    sources,
    segmentIds: [],
  });

describe('gerador de empresas fictícias', () => {
  const plans = generate();

  it('é determinístico: o mesmo seed gera a mesma base', () => {
    expect(generate(42, 50)).toEqual(generate(42, 50));
    expect(generate(7, 50)).not.toEqual(generate(42, 50));
  });

  it('todo contato, CNPJ e site é válido e fictício', () => {
    for (const { input } of plans) {
      const ddd = municipalities.find((m) => m.ibgeCode === input.municipalityCode)!.ddd!;
      for (const cp of input.contactPoints ?? []) {
        if (cp.type === 'PHONE') {
          const phone = normalizePhone(cp.value, { defaultDdd: String(ddd) });
          expect(phone.ok, cp.value).toBe(true);
          // Celular 9 0XXX-XXXX ou fixo 2000-XXXX.
          if (phone.ok) expect(phone.value.e164).toMatch(/^\+55\d{2}(90\d{7}|2000\d{4})$/);
        } else if (cp.type === 'EMAIL') {
          const email = normalizeEmail(cp.value);
          expect(email.ok && email.value.email.endsWith(`.${FAKE_EMAIL_DOMAIN}`)).toBe(true);
        } else {
          expect(normalizeInstagram(cp.value).ok, cp.value).toBe(true);
        }
      }
      if (input.cnpj) {
        const cnpj = normalizeCnpj(input.cnpj);
        expect(cnpj.ok && cnpj.value.cnpj.startsWith('ZZ')).toBe(true);
      }
      if (input.website) expect(normalizeUrl(input.website).ok).toBe(true);
    }
  });

  it('CNPJs não se repetem (o cadastro bloquearia); filiais compartilham só a raiz', () => {
    const cnpjs = plans.flatMap((p) => (p.input.cnpj ? [p.input.cnpj] : []));
    expect(new Set(cnpjs).size).toBe(cnpjs.length);
    const branch = plans.find((p) => p.duplicateKind === 'CNPJ_BRANCH');
    if (branch) {
      const original = plans[branch.duplicateOf!]!.input.cnpj!;
      expect(branch.input.cnpj!.slice(0, 8)).toBe(original.slice(0, 8));
    }
  });

  it('cerca de 5% de duplicados propositais, de vários tipos, apontando para um lead anterior', () => {
    const duplicates = plans.filter((p) => p.duplicateKind !== null);
    expect(duplicates.length).toBeGreaterThan(60);
    expect(duplicates.length).toBeLessThan(150);
    expect(new Set(duplicates.map((d) => d.duplicateKind)).size).toBeGreaterThanOrEqual(4);
    for (const [index, plan] of plans.entries()) {
      if (plan.duplicateOf !== null) {
        expect(plan.duplicateOf).toBeLessThan(index);
        expect(plans[plan.duplicateOf]!.duplicateKind).toBeNull();
        expect(plan.input.municipalityCode).toBe(plans[plan.duplicateOf]!.input.municipalityCode);
      }
    }
  });

  it('distribui opt-outs, arquivados, notas e pessoas fictícias', () => {
    expect(plans.filter((p) => p.optOut).length).toBeGreaterThan(40);
    expect(plans.filter((p) => p.archive).length).toBeGreaterThan(20);
    expect(plans.filter((p) => p.note).length).toBeGreaterThan(150);
    const people = plans.flatMap((p) => p.input.people ?? []);
    expect(people.length).toBeGreaterThan(500);
    expect(
      people.every((p) => / (Exemplo|Teste|Modelo|Amostra|Demonstração)$/.test(p.fullName)),
    ).toBe(true);
  });
});
