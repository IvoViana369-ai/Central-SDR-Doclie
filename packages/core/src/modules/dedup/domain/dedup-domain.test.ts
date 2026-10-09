import { describe, expect, it } from 'vitest';
import { uniqueSignals } from '../infra/candidates';
import {
  defaultMergeChoices,
  fieldDiffers,
  mergeCustomFields,
  mergedColumns,
  type MergeableLead,
} from './merge';
import { emailRule, signal } from './scoring';

const lead = (values: Partial<MergeableLead>): MergeableLead => ({
  tradeName: null,
  companyName: null,
  cnpj: null,
  cnpjRoot: null,
  cnpjHash: null,
  leadType: 'ACCOUNTING_FIRM',
  segmentId: null,
  category: null,
  cnaeMain: null,
  municipalityCode: null,
  cityRaw: null,
  stateUf: null,
  addressLine: null,
  addressNumber: null,
  addressComplement: null,
  neighborhood: null,
  postalCode: null,
  websiteUrl: null,
  websiteDomain: null,
  ownerId: null,
  description: null,
  ...values,
});

describe('mesclagem campo a campo', () => {
  const survivor = lead({
    tradeName: 'Alfa',
    municipalityCode: 2312908,
    cityRaw: 'Sobral',
    stateUf: 'CE',
    addressLine: 'Rua Fictícia',
    addressNumber: '10',
  });
  const merged = lead({
    tradeName: 'Alfa Contábil',
    companyName: 'Alfa Serviços Contábeis Ltda',
    cnpj: '11222333000181',
    cnpjRoot: '11222333',
    cnpjHash: 'hash',
    cityRaw: 'Sobral',
    municipalityCode: 2312908,
    stateUf: 'CE',
    addressLine: 'Avenida Exemplo',
    postalCode: '62010000',
  });

  it('padrão: fica o valor do sobrevivente; campo vazio é completado pelo outro', () => {
    expect(defaultMergeChoices(survivor, merged)).toMatchObject({
      tradeName: 'survivor',
      companyName: 'merged',
      cnpj: 'merged',
      location: 'survivor',
      address: 'survivor',
      description: 'survivor',
    });
  });

  it('grupos andam juntos (CNPJ com raiz e hash; endereço inteiro)', () => {
    const { patch, fields } = mergedColumns(survivor, merged, {
      ...defaultMergeChoices(survivor, merged),
      address: 'merged',
    });
    expect(fields).toEqual(['companyName', 'cnpj', 'address']);
    expect(patch).toEqual({
      companyName: 'Alfa Serviços Contábeis Ltda',
      cnpj: '11222333000181',
      cnpjRoot: '11222333',
      cnpjHash: 'hash',
      // O número do sobrevivente não fica misturado com a rua do outro.
      addressLine: 'Avenida Exemplo',
      addressNumber: null,
      addressComplement: null,
      neighborhood: null,
      postalCode: '62010000',
    });
  });

  it('escolher o outro num campo igual não muda nada', () => {
    expect(fieldDiffers(survivor, merged, 'location')).toBe(false);
    const all = Object.fromEntries(
      Object.keys(defaultMergeChoices(survivor, merged)).map((k) => [k, 'merged']),
    ) as ReturnType<typeof defaultMergeChoices>;
    expect(mergedColumns(survivor, merged, all).fields).not.toContain('location');
  });

  it('campos extras: os do sobrevivente valem, os do outro completam', () => {
    expect(mergeCustomFields({ porte: 'pequeno' }, { porte: 'médio', funcionarios: '12' })).toEqual(
      {
        porte: 'pequeno',
        funcionarios: '12',
      },
    );
    expect(mergeCustomFields(null, null)).toBeNull();
  });
});

describe('sinais', () => {
  it('e-mail de provedor gratuito vira EMAIL_FREE', () => {
    expect(emailRule('contato@alfa.example')).toBe('EMAIL');
    expect(emailRule('alguem@GMAIL.com')).toBe('EMAIL_FREE');
    expect(emailRule('alguem@bol.com.br')).toBe('EMAIL_FREE');
  });

  it('sinal repetido (mesma regra e detalhe) conta uma vez, em ordem estável', () => {
    const signals = uniqueSignals([
      signal('PHONE', '+55 88 9****-0001'),
      signal('NAME_CITY', 'mesmo nome na mesma cidade'),
      signal('PHONE', '+55 88 9****-0001'),
    ]);
    expect(signals.map((s) => s.rule)).toEqual(['NAME_CITY', 'PHONE']);
  });
});
