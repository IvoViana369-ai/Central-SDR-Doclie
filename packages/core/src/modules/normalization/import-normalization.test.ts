import { describe, expect, it } from 'vitest';
import {
  e164FromWhatsappId,
  formatName,
  MunicipalityIndex,
  nameCore,
  normalizeCnpj,
  normalizePhone,
  normalizeUf,
  parseCityState,
  splitList,
  whatsappIdVariants,
  type MunicipalityRef,
  type Normalized,
} from './index';

function value<T>(result: Normalized<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.reason}`);
  return result.value;
}

/**
 * Suítes obrigatórias da Fase 3 (docs/ARCHITECTURE.md §12.2). Os municípios
 * abaixo são reais (cadastro público do IBGE), sem dado pessoal.
 */
describe('telefone: casos da importação', () => {
  it('formatos de planilha do mesmo celular viram o mesmo E.164', () => {
    const inputs = [
      '(88) 99999-9999',
      '88999999999',
      '+55 88 99999-9999',
      '055 88 99999 9999',
      '0xx88 99999-9999',
      '0 88 99999-9999',
      '5588999999999',
      '88 9999-9999', // antigo, sem o 9º dígito
    ];
    for (const input of inputs) expect(value(normalizePhone(input)).e164).toBe('+5588999999999');
  });

  it('separa o ramal do número', () => {
    for (const input of [
      '(88) 3611-0000 ramal 25',
      '88 3611-0000 r. 25',
      '(88) 3611-0000 ext 25',
    ]) {
      const phone = value(normalizePhone(input));
      expect(phone).toMatchObject({ e164: '+558836110000', extension: '25', kind: 'LANDLINE' });
      expect(phone.flags).toContain('HAS_EXTENSION');
    }
    expect(value(normalizePhone('(88) 3611-0000')).extension).toBeNull();
  });

  it('números de serviço não são celulares (sem WhatsApp)', () => {
    for (const input of ['0800 123 4567', '4004-1234', '3003 1234']) {
      expect(value(normalizePhone(input)).kind).toBe('SERVICE');
    }
  });

  it('variantes do wa_id, com e sem o 9º dígito, voltam ao mesmo contato', () => {
    expect(whatsappIdVariants('+5588999998888')).toEqual(['5588999998888', '558899998888']);
    expect(whatsappIdVariants('+558836110000')).toEqual(['558836110000']);
    expect(e164FromWhatsappId('558899998888')).toBe('+5588999998888');
    expect(e164FromWhatsappId('5588999998888')).toBe('+5588999998888');
  });

  it('vários telefones na mesma célula', () => {
    expect(splitList('(88) 3611-0000 / (88) 99999-1111', { slash: true })).toEqual([
      '(88) 3611-0000',
      '(88) 99999-1111',
    ]);
    expect(splitList('(88)3611-0000/(88)99999-1111', { slash: true })).toHaveLength(2);
    expect(splitList('88 3611-0000 ou 88 99999-1111; 88 3611-2222')).toHaveLength(3);
    // Em links, a barra faz parte do valor.
    expect(splitList('https://instagram.com/contabil.x/')).toEqual([
      'https://instagram.com/contabil.x/',
    ]);
  });
});

describe('CNPJ: raiz e filial', () => {
  it('matriz e filial têm a mesma raiz', () => {
    const matriz = value(normalizeCnpj('11.222.333/0001-81'));
    const filial = value(normalizeCnpj('11.222.333/0002-62'));
    expect(matriz.root).toBe(filial.root);
    expect(matriz.cnpj).not.toBe(filial.cnpj);
  });
});

describe('nomes', () => {
  it('padroniza texto todo em maiúsculas ou minúsculas, com siglas e preposições', () => {
    expect(formatName('ESCRITÓRIO CONTÁBIL SILVA E SOUZA LTDA')).toBe(
      'Escritório Contábil Silva e Souza Ltda',
    );
    expect(formatName('  contabilidade   da   serra me ')).toBe('Contabilidade da Serra ME');
    expect(formatName("MARIA D'ÁVILA DOS SANTOS")).toBe("Maria D'Ávila dos Santos");
    expect(formatName('ORGANIZAÇÃO PAU-BRASIL S/S')).toBe('Organização Pau-Brasil S/S');
    expect(formatName('DE PAULA CONTADORES')).toBe('De Paula Contadores');
  });

  it('respeita capitalização mista digitada de propósito', () => {
    expect(formatName('iContábil  BPO')).toBe('iContábil BPO');
  });

  it('nome sem termos genéricos para comparar similaridade', () => {
    expect(nameCore('Contabilidade Silva Ltda')).toBe('silva');
    expect(nameCore('Contabilidade Souza')).toBe('souza');
    expect(nameCore('Contabilidade Ltda')).toBe('contabilidade ltda');
  });
});

describe('cidade e UF', () => {
  it('UF por sigla ou por extenso', () => {
    expect(value(normalizeUf('ce'))).toBe('CE');
    expect(value(normalizeUf('Ceará'))).toBe('CE');
    expect(value(normalizeUf('mato grosso do sul'))).toBe('MS');
    expect(normalizeUf('XX').ok).toBe(false);
  });

  it('separa a UF escrita junto com a cidade', () => {
    expect(parseCityState('Sobral - CE')).toEqual({ city: 'Sobral', uf: 'CE' });
    expect(parseCityState('Sobral/CE')).toEqual({ city: 'Sobral', uf: 'CE' });
    expect(parseCityState('Sobral (CE)')).toEqual({ city: 'Sobral', uf: 'CE' });
    expect(parseCityState('São Paulo SP')).toEqual({ city: 'São Paulo', uf: 'SP' });
    expect(parseCityState('Sobral, Ceará')).toEqual({ city: 'Sobral', uf: 'CE' });
    expect(parseCityState('Bom Jesus do Tocantins')).toEqual({
      city: 'Bom Jesus do Tocantins',
      uf: null,
    });
    expect(parseCityState('Ji-Paraná')).toEqual({ city: 'Ji-Paraná', uf: null });
  });

  const ref = (ibgeCode: number, name: string, uf: string): MunicipalityRef => ({
    ibgeCode,
    name,
    uf,
    nameSearch: name
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim(),
    ddd: null,
  });
  const index = new MunicipalityIndex([
    ref(2312908, 'Sobral', 'CE'),
    ref(2311900, 'Santa Quitéria', 'CE'),
    ref(1100122, 'Ji-Paraná', 'RO'),
    ref(2201804, 'Bom Jesus', 'PI'),
    ref(4302402, 'Bom Jesus', 'RS'),
    ref(3304557, 'Rio de Janeiro', 'RJ'),
  ]);

  it('casa com o cadastro do IBGE, com e sem UF, acentos e abreviações', () => {
    expect(index.match('SOBRAL')).toMatchObject({
      status: 'MATCHED',
      municipality: { ibgeCode: 2312908 },
    });
    expect(index.match('Sta. Quiteria', 'CE')).toMatchObject({
      status: 'MATCHED',
      municipality: { ibgeCode: 2311900 },
    });
    expect(index.match('Ji-Paraná')).toMatchObject({ municipality: { uf: 'RO' } });
    expect(index.match('Rio de Janeiro')).toMatchObject({ municipality: { uf: 'RJ' } });
    expect(index.match('Bom Jesus - RS')).toMatchObject({ municipality: { ibgeCode: 4302402 } });
  });

  it('mesmo nome em UFs diferentes sem UF fica ambíguo; cidade fora da UF não casa', () => {
    expect(index.match('Bom Jesus')).toMatchObject({ status: 'AMBIGUOUS' });
    expect(index.match('Sobral', 'SP')).toEqual({ status: 'NOT_FOUND' });
    expect(index.match('Cidade Inexistente')).toEqual({ status: 'NOT_FOUND' });
  });
});
