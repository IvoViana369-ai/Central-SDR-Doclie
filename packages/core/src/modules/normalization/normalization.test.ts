import { describe, expect, it } from 'vitest';
import { createIdentifierHasher } from '../../shared/identifier-hash';
import {
  formatCnpj,
  formatPhone,
  maskPhone,
  nameCore,
  normalizeCnpj,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizePostalCode,
  normalizeUrl,
  whatsappLink,
  type Normalized,
} from './index';

function value<T>(result: Normalized<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.reason}`);
  return result.value;
}

function reason<T>(result: Normalized<T>): string {
  if (result.ok) throw new Error('esperava falha');
  return result.reason;
}

describe('normalizePhone', () => {
  it('aceite M02/M05: formatos diferentes do mesmo celular resultam no mesmo valor', () => {
    const inputs = ['(88) 99999-9999', '88999999999', '+55 88 99999-9999'];
    const results = inputs.map((input) => value(normalizePhone(input)).e164);
    expect(new Set(results)).toEqual(new Set(['+5588999999999']));
  });

  it('classifica celular e fixo', () => {
    expect(value(normalizePhone('(85) 3221-1234'))).toEqual({
      e164: '+558532211234',
      kind: 'LANDLINE',
      ddd: '85',
      flags: [],
      extension: null,
    });
    expect(value(normalizePhone('85 98765 4321')).kind).toBe('MOBILE');
  });

  it('acrescenta o 9º dígito em celulares antigos e registra a correção', () => {
    expect(value(normalizePhone('(88) 8765-4321'))).toMatchObject({
      e164: '+5588987654321',
      kind: 'MOBILE',
      flags: ['ADDED_NINTH_DIGIT'],
    });
  });

  it('aceita zero de longa distância, com e sem código de operadora', () => {
    expect(value(normalizePhone('0 88 99999-9999')).e164).toBe('+5588999999999');
    expect(value(normalizePhone('0 21 88 99999-9999'))).toMatchObject({
      e164: '+5588999999999',
      flags: ['REMOVED_CARRIER_CODE'],
    });
    expect(value(normalizePhone('0055 88 3221-1234')).e164).toBe('+558832211234');
  });

  it('DDD 55 sem código do país não é confundido com o código do Brasil', () => {
    expect(value(normalizePhone('(55) 99999-9999')).e164).toBe('+5555999999999');
    expect(value(normalizePhone('55 55 3222-1234')).e164).toBe('+555532221234');
  });

  it('sem DDD, só normaliza com o DDD do contexto e registra a inferência', () => {
    expect(reason(normalizePhone('99999-9999'))).toBe('MISSING_DDD');
    expect(reason(normalizePhone('+55 99999-9999'))).toBe('MISSING_DDD');
    expect(value(normalizePhone('99999-9999', { defaultDdd: '88' }))).toMatchObject({
      e164: '+5588999999999',
      flags: ['INFERRED_DDD'],
    });
  });

  it('recusa DDD inexistente, tamanho errado e celular de 9 dígitos sem o 9', () => {
    expect(reason(normalizePhone('(20) 99999-9999'))).toBe('INVALID_DDD');
    expect(reason(normalizePhone('123'))).toBe('INVALID_LENGTH');
    expect(reason(normalizePhone('(88) 89999-9999'))).toBe('INVALID_NUMBER');
    expect(reason(normalizePhone('  '))).toBe('EMPTY');
  });

  it('guarda números de serviço só com dígitos', () => {
    expect(value(normalizePhone('0800 123 4567'))).toMatchObject({
      e164: '08001234567',
      kind: 'SERVICE',
    });
    expect(value(normalizePhone('4004-1234')).kind).toBe('SERVICE');
  });

  it('mantém números estrangeiros em E.164', () => {
    expect(value(normalizePhone('+1 (415) 555-0100'))).toMatchObject({
      e164: '+14155550100',
      kind: 'UNKNOWN',
      flags: ['INTERNATIONAL'],
    });
  });

  it('formata, mascara e gera o link do WhatsApp', () => {
    expect(formatPhone('+5588999999999')).toBe('(88) 99999-9999');
    expect(formatPhone('+558832211234')).toBe('(88) 3221-1234');
    expect(maskPhone('+5588999999999')).toBe('+55 88 9****-9999');
    expect(whatsappLink('+5588999999999', 'Olá, tudo bem?')).toBe(
      'https://wa.me/5588999999999?text=Ol%C3%A1%2C%20tudo%20bem%3F',
    );
    expect(whatsappLink('08001234567')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('padroniza e identifica provedores gratuitos', () => {
    expect(value(normalizeEmail('  Contato@Escritorio.COM.br '))).toEqual({
      email: 'contato@escritorio.com.br',
      domain: 'escritorio.com.br',
      isFreeProvider: false,
    });
    expect(value(normalizeEmail('mailto:Fulano@Gmail.com')).isFreeProvider).toBe(true);
  });

  it('recusa formatos inválidos', () => {
    for (const invalid of ['sem-arroba', 'a@b', 'a..b@x.com', '@x.com', 'a@x..com', 'a b@x.com']) {
      expect(reason(normalizeEmail(invalid)), invalid).toBe('INVALID_FORMAT');
    }
  });
});

describe('normalizeCnpj', () => {
  it('valida CNPJ numérico com e sem máscara', () => {
    expect(value(normalizeCnpj('11.222.333/0001-81'))).toEqual({
      cnpj: '11222333000181',
      root: '11222333',
      isAlphanumeric: false,
    });
    expect(value(normalizeCnpj('11222333000181')).cnpj).toBe('11222333000181');
  });

  it('valida CNPJ alfanumérico (exemplo oficial da Receita), inclusive em minúsculas', () => {
    expect(value(normalizeCnpj('12.abc.345/01de-35'))).toEqual({
      cnpj: '12ABC34501DE35',
      root: '12ABC345',
      isAlphanumeric: true,
    });
  });

  it('recusa DV errado, sequências repetidas e formato inválido', () => {
    expect(reason(normalizeCnpj('11.222.333/0001-82'))).toBe('INVALID_CHECK_DIGIT');
    expect(reason(normalizeCnpj('12ABC34501DE36'))).toBe('INVALID_CHECK_DIGIT');
    expect(reason(normalizeCnpj('00000000000000'))).toBe('INVALID_CHECK_DIGIT');
    expect(reason(normalizeCnpj('12ABC34501DEAB'))).toBe('INVALID_FORMAT');
    expect(reason(normalizeCnpj('1122233300018'))).toBe('INVALID_FORMAT');
  });

  it('formata para exibição', () => {
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
});

describe('normalizeInstagram', () => {
  it('extrai o usuário de @, texto ou URL', () => {
    for (const input of [
      '@Escritorio.Contabil',
      'escritorio.contabil',
      'https://www.instagram.com/escritorio.contabil/?hl=pt-br',
      'instagram.com/Escritorio.Contabil',
    ]) {
      expect(value(normalizeInstagram(input)), input).toEqual({
        handle: 'escritorio.contabil',
        url: 'https://www.instagram.com/escritorio.contabil/',
      });
    }
  });

  it('recusa links que não são de perfil e usuários inválidos', () => {
    expect(reason(normalizeInstagram('https://instagram.com/p/AbC123/'))).toBe('NOT_A_PROFILE');
    expect(reason(normalizeInstagram('usuario com espaço'))).toBe('INVALID_FORMAT');
    expect(reason(normalizeInstagram('.comeca.com.ponto'))).toBe('INVALID_FORMAT');
    expect(reason(normalizeInstagram('a'.repeat(31)))).toBe('INVALID_FORMAT');
  });
});

describe('normalizeUrl', () => {
  it('acrescenta https, padroniza o domínio e remove rastreio', () => {
    expect(value(normalizeUrl('WWW.Escritorio.com.br/contato/?utm_source=google&id=7'))).toEqual({
      url: 'https://www.escritorio.com.br/contato?id=7',
      domain: 'escritorio.com.br',
    });
    expect(value(normalizeUrl('http://escritorio.com.br/'))).toEqual({
      url: 'http://escritorio.com.br',
      domain: 'escritorio.com.br',
    });
  });

  it('recusa esquemas perigosos e domínios inválidos', () => {
    expect(reason(normalizeUrl('javascript:alert(1)'))).toBe('INVALID_SCHEME');
    expect(reason(normalizeUrl('ftp://x.com'))).toBe('INVALID_SCHEME');
    expect(reason(normalizeUrl('localhost'))).toBe('INVALID_HOST');
    expect(reason(normalizeUrl('https://user:pass@x.com'))).toBe('INVALID_FORMAT');
  });
});

describe('textos', () => {
  it('nameCore ignora termos genéricos do setor', () => {
    expect(nameCore('Escritório Contábil Silva & Associados Ltda')).toBe('silva');
    expect(nameCore('Contabilidade Ltda')).toBe('contabilidade ltda');
  });

  it('CEP com 8 dígitos', () => {
    expect(value(normalizePostalCode('62.010-000'))).toBe('62010000');
    expect(reason(normalizePostalCode('6201'))).toBe('INVALID_LENGTH');
  });
});

describe('createIdentifierHasher', () => {
  const hasher = createIdentifierHasher('pepper-de-teste-com-pelo-menos-32-caracteres');

  it('é determinístico e separa os tipos de identificador', () => {
    const a = hasher.hash('PHONE', '+5588999999999');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.hash('PHONE', '+5588999999999')).toBe(a);
    expect(hasher.hash('EMAIL', '+5588999999999')).not.toBe(a);
  });

  it('depende do pepper e exige um pepper forte', () => {
    const other = createIdentifierHasher('outro-pepper-de-teste-com-32-caracteres!!');
    expect(other.hash('PHONE', '+5588999999999')).not.toBe(hasher.hash('PHONE', '+5588999999999'));
    expect(() => createIdentifierHasher('curto')).toThrow(/32 caracteres/);
  });
});
