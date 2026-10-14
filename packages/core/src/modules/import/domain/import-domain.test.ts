import { describe, expect, it } from 'vitest';
import { scoreSignals, signal } from '../../dedup';
import { MunicipalityIndex, toSearchKey } from '../../normalization';
import { allowedDecisions, defaultDecision } from './decisions';
import { detectHeaderRow, headerSignature, suggestMapping, suggestTarget } from './fields';
import { normalizeImportRow, type RowContext } from './row';

describe('sugestão de mapeamento (M04)', () => {
  it('reconhece nomes comuns de coluna, com e sem acento', () => {
    const cases: [string, string][] = [
      ['Telefone comercial', 'phone'],
      ['Nome Escritório', 'tradeName'],
      ['Município', 'city'],
      ['Razão Social', 'companyName'],
      ['E-mail', 'email'],
      ['WhatsApp', 'whatsapp'],
      ['Cel. (WhatsApp)', 'whatsapp'],
      ['CNPJ/CPF', 'cnpj'],
      ['UF', 'state'],
      ['Instagram', 'instagram'],
      ['Site', 'website'],
      ['Nº de funcionários', 'custom'],
      ['', 'ignore'],
    ];
    for (const [header, target] of cases) expect(suggestTarget(header).target, header).toBe(target);
  });

  it('campo de valor único fica com a primeira coluna; telefones podem ser vários', () => {
    const mapping = suggestMapping(['Nome', 'Empresa', 'Telefone 1', 'Telefone 2', 'Obs']);
    expect(mapping.map((m) => m.target)).toEqual([
      'tradeName',
      'custom',
      'phone',
      'phone',
      'description',
    ]);
    expect(mapping[1]!.customKey).toBe('empresa');
  });

  it('assinatura do cabeçalho ignora acento e caixa', () => {
    expect(headerSignature(['Município', 'TELEFONE'])).toBe(
      headerSignature(['municipio', 'Telefone']),
    );
  });

  it('acha o cabeçalho abaixo de títulos', () => {
    const rows = [
      { number: 1, cells: ['Lista de escritórios — fictícia'] },
      { number: 2, cells: ['2026', '10'] },
      { number: 3, cells: ['Nome', 'Telefone', 'Cidade'] },
      { number: 4, cells: ['Alfa', '(88) 99999-0001', 'Sobral'] },
    ];
    expect(detectHeaderRow(rows)).toBe(3);
  });
});

const ref = (ibgeCode: number, name: string, uf: string, ddd: number) => ({
  ibgeCode,
  name,
  uf,
  nameSearch: toSearchKey(name),
  ddd,
});
const context: RowContext = {
  municipalities: new MunicipalityIndex([
    ref(2312908, 'Sobral', 'CE', 88),
    ref(2201804, 'Bom Jesus', 'PI', 89),
    ref(4302402, 'Bom Jesus', 'RS', 54),
  ]),
  segments: new Map([['pequenos escritorios', 'seg-1']]),
  tags: new Map([['parceiro', 'tag-1']]),
};

describe('normalização da linha', () => {
  const mapping = suggestMapping([
    'Nome',
    'Razão social',
    'CNPJ',
    'Telefone',
    'WhatsApp',
    'E-mail',
    'Cidade',
    'Contato',
    'Cargo',
    'Segmento',
    'Tags',
    'Funcionários',
  ]);

  it('normaliza tudo e completa o DDD pela cidade', () => {
    const result = normalizeImportRow(
      [
        'CONTÁBIL ALFA',
        'alfa serviços contábeis ltda',
        '11.222.333/0001-81',
        '3611-0000 ramal 2 / 99999-0001',
        '(88) 99999-0001',
        'Contato@Alfa.example; financeiro@alfa.example',
        'Sobral/CE',
        'MARIA EXEMPLO',
        'Sócia',
        'Pequenos escritórios',
        'Parceiro',
        '12',
      ],
      mapping,
      context,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.normalized).toMatchObject({
      tradeName: 'Contábil Alfa',
      companyName: 'Alfa Serviços Contábeis Ltda',
      cnpj: '11222333000181',
      municipalityCode: 2312908,
      stateUf: 'CE',
      person: { fullName: 'Maria Exemplo', roleTitle: 'Sócia' },
      segmentId: 'seg-1',
      tagIds: ['tag-1'],
      customFields: { funcionarios: '12' },
    });
    expect(result.normalized!.contacts).toEqual([
      { type: 'PHONE', value: '+558836110000', isWhatsapp: false, label: 'Ramal 2' },
      // O mesmo celular na coluna WhatsApp vira um contato só, marcado como WhatsApp.
      { type: 'PHONE', value: '+5588999990001', isWhatsapp: true, label: null },
      { type: 'EMAIL', value: 'contato@alfa.example', isWhatsapp: false, label: null },
      { type: 'EMAIL', value: 'financeiro@alfa.example', isWhatsapp: false, label: null },
    ]);
  });

  it('valores ruins viram aviso (e são ignorados); sem nome é erro', () => {
    const result = normalizeImportRow(
      [
        'Beta',
        '',
        '123',
        'abc',
        '',
        'nao-e-email',
        'Bom Jesus',
        '',
        '',
        'Inexistente',
        'Nova Tag',
        '',
      ],
      mapping,
      context,
    );
    expect(result.errors).toEqual([]);
    expect(result.normalized).toMatchObject({
      cnpj: null,
      contacts: [],
      municipalityCode: null,
      cityName: 'Bom Jesus',
    });
    const messages = result.warnings.map((w) => `${w.column}: ${w.message}`);
    expect(messages).toEqual([
      expect.stringMatching(/^Cidade: "Bom Jesus" existe em mais de uma UF \(PI, RS\)/),
      expect.stringMatching(/^CNPJ: .*Valor ignorado\.$/),
      expect.stringMatching(/^Telefone: Telefone "abc" ignorado/),
      expect.stringMatching(/^E-mail: E-mail "nao-e-email" ignorado/),
      'Segmento: Segmento "Inexistente" não existe.',
      'Tags: Tag "Nova Tag" não existe (crie antes de importar).',
    ]);

    const noName = normalizeImportRow(['', '', '', '(88) 99999-0001'], mapping, context);
    expect(noName.normalized).toBeNull();
    expect(noName.errors).toEqual([
      { column: null, message: 'Sem nome (fantasia ou razão social).' },
    ]);
  });
});

describe('decisões por linha', () => {
  it('padrão pela política; na dúvida nada é alterado no existente', () => {
    expect(defaultDecision('NEW', 'SKIP')).toBe('IMPORT');
    expect(defaultDecision('EXISTING', 'CREATE_AND_FLAG')).toBe('LINK_EXISTING');
    expect(defaultDecision('EXISTING', 'UPDATE_EMPTY_FIELDS')).toBe('UPDATE_EXISTING');
    expect(defaultDecision('POSSIBLE_DUPLICATE', 'UPDATE_EMPTY_FIELDS')).toBe('IMPORT');
    expect(defaultDecision('POSSIBLE_DUPLICATE', 'SKIP')).toBe('SKIP');
    expect(defaultDecision('SUPPRESSED', 'CREATE_AND_FLAG')).toBe('SKIP');
    expect(defaultDecision('INVALID', 'CREATE_AND_FLAG')).toBe('SKIP');
  });

  it('CNPJ já cadastrado, inválido ou na Lista Não Contatar não vira lead novo', () => {
    expect(allowedDecisions('EXISTING', { hasMatch: true, matchedByCnpj: true })).not.toContain(
      'IMPORT',
    );
    expect(allowedDecisions('EXISTING', { hasMatch: true, matchedByCnpj: false })).toContain(
      'IMPORT',
    );
    expect(allowedDecisions('INVALID', { hasMatch: false, matchedByCnpj: false })).toEqual([
      'SKIP',
    ]);
    expect(allowedDecisions('SUPPRESSED', { hasMatch: true, matchedByCnpj: false })).toEqual([
      'LINK_EXISTING',
      'SKIP',
    ]);
  });
});

describe('score de duplicidade', () => {
  it('sinais combinam sem passar de 1; filial sozinha é sempre confiança baixa', () => {
    expect(scoreSignals([signal('CNPJ', 'x')])).toEqual({ score: 1, confidence: 'HIGH' });
    expect(scoreSignals([signal('PHONE', 'x'), signal('EMAIL', 'y')])).toEqual({
      score: 0.96,
      confidence: 'HIGH',
    });
    expect(scoreSignals([signal('NAME_CITY', 'x')])).toEqual({ score: 0.6, confidence: 'LOW' });
    expect(scoreSignals([signal('PHONE', 'x')])).toMatchObject({ confidence: 'MEDIUM' });
    expect(scoreSignals([signal('CNPJ_ROOT', 'x')])).toMatchObject({ confidence: 'LOW' });
    // O mesmo sinal repetido conta uma vez.
    expect(scoreSignals([signal('PHONE', 'a'), signal('PHONE', 'b')]).score).toBe(0.8);
  });
});
