import { describe, expect, it } from 'vitest';
import { FakeCompanyRegistrySource, fakeCnpj } from '../infra/fake-source';
import {
  companyRootOf,
  encodeLatin1,
  isIndividualNature,
  mayBeAccountingLine,
  parseCompanyLine,
  parseEstablishmentLine,
  parseMunicipalityLine,
  parseReceitaDate,
  readLatin1Lines,
  receitaCsvLine,
  registryNameSearch,
  splitReceitaLine,
  stripCpfFromName,
} from './receita';
import { formatCnae, PROSPECTING_MATCH_LABELS } from './labels';
import {
  DEFAULT_REGISTRY_SETTINGS,
  isRegistryReference,
  resolveRegistrySettings,
} from './settings';

/** Linha de Estabelecimentos fictícia (30 colunas, layout da Receita). */
function establishment(overrides: Record<number, string> = {}) {
  const cnpj = fakeCnpj('FK000777');
  const fields: string[] = [
    'FK000777', // 0 raiz
    '0001', // 1 ordem
    cnpj.slice(12), // 2 DV
    '1', // 3 matriz
    'ESCRITÓRIO CONTÁBIL TESTE', // 4 nome fantasia
    '02', // 5 situação
    '20200101', // 6 data da situação
    '00', // 7 motivo
    '', // 8 cidade no exterior
    '', // 9 país
    '20150310', // 10 início da atividade
    '6920601', // 11 CNAE principal
    '8211300,7020400', // 12 CNAEs secundários
    'RUA', // 13 tipo de logradouro
    'CORONEL FICTÍCIO', // 14 logradouro
    'SN', // 15 número
    'SALA 2', // 16 complemento
    'CENTRO', // 17 bairro
    '62010000', // 18 CEP
    'CE', // 19 UF
    '1559', // 20 município (código da Receita)
    '88', // 21 DDD 1
    '36110777', // 22 telefone 1
    '88', // 23 DDD 2
    '999900777', // 24 telefone 2
    '', // 25 DDD fax
    '', // 26 fax
    'CONTATO@TESTE-CONTABIL.EXAMPLE', // 27 e-mail
    '', // 28 situação especial
    '', // 29 data da situação especial
  ];
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
  return receitaCsvLine(fields);
}

const DEFAULT_FILTER = { includeSecondaryCnae: false };

describe('arquivos da Receita: linhas e campos', () => {
  it('separa campos com aspas, ponto e vírgula dentro, aspas dobradas e soltas', () => {
    expect(splitReceitaLine('"a";"b;c";"d ""e"""')).toEqual(['a', 'b;c', 'd "e"']);
    expect(splitReceitaLine('"1";"";"x"')).toEqual(['1', '', 'x']);
    // Aspa solta no meio do texto (acontece na base real): fica no campo.
    expect(splitReceitaLine('"ED. "ALFA" SALA 2";"B"')).toEqual(['ED. "ALFA" SALA 2', 'B']);
    expect(splitReceitaLine('1;abc;')).toEqual(['1', 'abc', '']);
    expect(splitReceitaLine('"só um"')).toEqual(['só um']);
  });

  it('datas AAAAMMDD; zeros e datas impossíveis viram nulo', () => {
    expect(parseReceitaDate('20150310')).toEqual(new Date(Date.UTC(2015, 2, 10)));
    expect(parseReceitaDate('00000000')).toBeNull();
    expect(parseReceitaDate('0')).toBeNull();
    expect(parseReceitaDate('20150231')).toBeNull();
  });

  it('lê linhas em Latin-1 entregues em pedaços que cortam linhas no meio', async () => {
    const bytes = encodeLatin1('"JOSÉ";"AÇÃO"\r\n"SEGUNDA";"LINHA"\r\n\r\n"ÚLTIMA";"SEM QUEBRA"');
    async function* chunks() {
      for (let i = 0; i < bytes.length; i += 5) yield bytes.slice(i, i + 5);
    }
    const lines: string[] = [];
    for await (const line of readLatin1Lines(chunks())) lines.push(line);
    expect(lines).toEqual(['"JOSÉ";"AÇÃO"', '"SEGUNDA";"LINHA"', '"ÚLTIMA";"SEM QUEBRA"']);
  });
});

describe('arquivos da Receita: recorte de contabilidade', () => {
  it('estabelecimento ativo de contabilidade: normaliza CNPJ, nomes, endereço, telefones e e-mail', () => {
    const line = establishment();
    expect(mayBeAccountingLine(line)).toBe(true);
    const parsed = parseEstablishmentLine(line, DEFAULT_FILTER);
    expect(parsed).toEqual({
      kind: 'kept',
      establishment: {
        cnpj: fakeCnpj('FK000777'),
        cnpjRoot: 'FK000777',
        isHeadOffice: true,
        tradeName: 'Escritório Contábil Teste',
        cnaeMain: '6920601',
        cnaesSecondary: ['8211300', '7020400'],
        openedAt: new Date(Date.UTC(2015, 2, 10)),
        uf: 'CE',
        receitaMunicipalityCode: 1559,
        addressLine: 'Rua Coronel Fictício',
        addressNumber: 'S/N',
        addressComplement: 'SALA 2',
        neighborhood: 'Centro',
        postalCode: '62010000',
        phone1: '+558836110777',
        phone2: '+5588999900777',
        email: 'contato@teste-contabil.example',
      },
    });
  });

  it('fica de fora: baixado, outra atividade, exterior; secundária só quando ligada', () => {
    expect(parseEstablishmentLine(establishment({ 5: '08' }), DEFAULT_FILTER).kind).toBe('skipped');
    expect(parseEstablishmentLine(establishment({ 5: '2' }), DEFAULT_FILTER).kind).toBe('kept');
    expect(parseEstablishmentLine(establishment({ 11: '1091101' }), DEFAULT_FILTER).kind).toBe(
      'skipped',
    );
    expect(parseEstablishmentLine(establishment({ 19: 'EX' }), DEFAULT_FILTER).kind).toBe(
      'skipped',
    );
    const secondary = establishment({ 11: '4761003', 12: '6920601' });
    expect(parseEstablishmentLine(secondary, DEFAULT_FILTER).kind).toBe('skipped');
    expect(parseEstablishmentLine(secondary, { includeSecondaryCnae: true }).kind).toBe('kept');
    expect(mayBeAccountingLine(establishment({ 11: '1091101', 12: '' }))).toBe(false);
  });

  it('linha fora do layout ou CNPJ inválido é contada como inválida; contatos ruins viram nulo', () => {
    expect(parseEstablishmentLine('"1";"2"', DEFAULT_FILTER).kind).toBe('invalid');
    expect(parseEstablishmentLine(establishment({ 2: '00' }), DEFAULT_FILTER).kind).toBe('invalid');
    const messy = parseEstablishmentLine(
      establishment({ 21: '', 22: '36110777', 23: '08', 24: '00123456', 27: 'sem-arroba' }),
      DEFAULT_FILTER,
    );
    expect(messy).toMatchObject({
      kind: 'kept',
      establishment: { phone1: null, phone2: null, email: null },
    });
  });

  it('empresa: CPF fora da razão social, natureza de pessoa física e porte', () => {
    const company = parseCompanyLine(
      receitaCsvLine([
        'FK000903',
        'MARIA FICTICIA DE SOUSA 12345678909',
        '2135',
        '50',
        '0,00',
        '1',
        '',
      ]),
    );
    expect(company).toEqual({
      cnpjRoot: 'FK000903',
      companyName: 'Maria Ficticia de Sousa',
      legalNature: '2135',
      isIndividualEntrepreneur: true,
      companySize: '01',
    });
    expect(stripCpfFromName('JOÃO FICTÍCIO 123.456.789-09')).toBe('JOÃO FICTÍCIO');
    expect(stripCpfFromName('CONTABILIDADE 2000 LTDA')).toBe('CONTABILIDADE 2000 LTDA');
    expect(isIndividualNature('2062')).toBe(false);
    expect(isIndividualNature('4120')).toBe(true);
    expect(companyRootOf('"FK000903";"MARIA"')).toBe('FK000903');
    expect(companyRootOf('lixo')).toBeNull();
    expect(parseCompanyLine('"FK000903";"X"')).toBeNull();
  });

  it('município da Receita e nome para busca', () => {
    expect(parseMunicipalityLine('"1559";"SOBRAL"')).toEqual({ code: 1559, name: 'SOBRAL' });
    expect(parseMunicipalityLine('"x";"SOBRAL"')).toBeNull();
    expect(registryNameSearch(null, 'Contábil Ômega Ltda')).toBe('contabil omega ltda');
    expect(registryNameSearch('Alfa Contábil', 'Outra Razão')).toBe('alfa contabil');
  });
});

describe('base simulada e configuração', () => {
  it('mesmo layout e arquivos da Receita, com escritórios fictícios e as exceções', async () => {
    const source = new FakeCompanyRegistrySource();
    const reference = await source.latestReference();
    expect(reference).toBe('2026-09');
    const files = await source.listFiles(reference);
    expect(files.map((f) => f.kind)).toEqual([
      'MUNICIPALITIES',
      'ESTABLISHMENTS',
      'ESTABLISHMENTS',
      'COMPANIES',
    ]);
    const counts = { kept: 0, skipped: 0, invalid: 0, secondary: 0 };
    for (const file of files.filter((f) => f.kind === 'ESTABLISHMENTS')) {
      for await (const line of readLatin1Lines(source.open(reference, file))) {
        counts[parseEstablishmentLine(line, DEFAULT_FILTER).kind] += 1;
        if (parseEstablishmentLine(line, { includeSecondaryCnae: true }).kind === 'kept') {
          counts.secondary += 1;
        }
      }
    }
    // 28 escritórios + a filial + o do município sem correspondência + o empresário individual.
    expect(counts).toEqual({ kept: 31, skipped: 8, invalid: 0, secondary: 32 });
    await expect(source.listFiles('2026-10')).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('rótulos: CNAE formatado e comparação da busca', () => {
    expect(formatCnae('6920601')).toBe('6920-6/01');
    expect(formatCnae('692060')).toBe('692060');
    expect(PROSPECTING_MATCH_LABELS.DUPLICATE_IN_FILE).toBe('Repetido na busca');
  });

  it('padrões restritivos e mês da base', () => {
    expect(resolveRegistrySettings(undefined)).toEqual(DEFAULT_REGISTRY_SETTINGS);
    expect(resolveRegistrySettings({ includeIndividualEntrepreneurs: true })).toMatchObject({
      includeIndividualEntrepreneurs: true,
      includeSecondaryCnae: false,
    });
    expect(resolveRegistrySettings({ monthlyIngestion: 'sim' })).toEqual(DEFAULT_REGISTRY_SETTINGS);
    expect(isRegistryReference('2026-09')).toBe(true);
    expect(isRegistryReference('2026-13')).toBe(false);
    expect(isRegistryReference('2017-12')).toBe(false);
  });
});
