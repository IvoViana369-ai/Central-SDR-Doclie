import {
  CompanyRegistryError,
  type CompanyRegistrySource,
  type RegistryFile,
} from '../../../ports/company-registry';
import { cnpjCheckDigits } from '../../normalization';
import { encodeLatin1, receitaCsvLine } from '../domain/receita';

/**
 * Base aberta do CNPJ simulada (`COMPANY_REGISTRY_PROVIDER=fake`): os mesmos
 * arquivos e o mesmo layout da Receita, com escritórios **fictícios**. Os CNPJs
 * têm raiz alfanumérica começando com "FK" (dígitos verificadores válidos, sem
 * risco de coincidir com uma empresa real), e-mails em `.example` e nomes
 * inventados. Inclui o que a carga precisa descartar: baixados, outra
 * atividade, empresário individual e cidade sem correspondência no IBGE.
 */

interface FakeCity {
  receita: number;
  name: string;
  uf: string;
  ddd: string;
}

const CITIES: Record<string, FakeCity> = {
  sobral: { receita: 1559, name: 'SOBRAL', uf: 'CE', ddd: '88' },
  fortaleza: { receita: 1389, name: 'FORTALEZA', uf: 'CE', ddd: '85' },
  juazeiro: { receita: 1495, name: 'JUAZEIRO DO NORTE', uf: 'CE', ddd: '88' },
  crato: { receita: 1381, name: 'CRATO', uf: 'CE', ddd: '88' },
  iguatu: { receita: 1423, name: 'IGUATU', uf: 'CE', ddd: '88' },
  teresina: { receita: 1219, name: 'TERESINA', uf: 'PI', ddd: '86' },
  // Nome que não existe no IBGE: o estabelecimento fica sem município casado.
  ficticia: { receita: 9991, name: 'CIDADE FICTICIA DO SERTAO', uf: 'CE', ddd: '88' },
};

interface FakeEstablishment {
  root: string;
  order: string;
  tradeName: string;
  status: '02' | '08';
  cnaeMain: string;
  cnaesSecondary: string[];
  city: FakeCity;
  street: string;
  number: string;
  neighborhood: string;
  postalCode: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  openedAt: string;
}

interface FakeCompany {
  root: string;
  name: string;
  nature: string;
  size: string;
}

const NAMES = [
  'ALFA',
  'BETA',
  'GAMA',
  'DELTA',
  'ÔMEGA',
  'SIGMA',
  'ATLAS',
  'HORIZONTE',
  'AURORA',
  'CEDRO',
  'IPÊ',
  'JATOBÁ',
  'AROEIRA',
  'CARNAÚBA',
  'CAJUÍNA',
  'MANDACARU',
  'SERRA AZUL',
  'BOA VISTA',
  'PRIMAVERA',
  'VENTO NORTE',
  'SOL NASCENTE',
  'BRISA',
  'MARÉ ALTA',
  'CAATINGA',
  'IBIAPABA',
  'ARARIPE',
  'PARNAÍBA',
  'POTI',
] as const;

const PATTERNS = [
  (n: string) => `CONTABILIDADE ${n}`,
  (n: string) => `ESCRITÓRIO CONTÁBIL ${n}`,
  (n: string) => `${n} ASSESSORIA CONTÁBIL`,
  (n: string) => `${n} CONTADORES ASSOCIADOS`,
] as const;

/** Quantos escritórios fictícios por cidade (o resto do conjunto são exceções). */
const PER_CITY: [keyof typeof CITIES, number][] = [
  ['sobral', 8],
  ['fortaleza', 9],
  ['juazeiro', 4],
  ['crato', 3],
  ['iguatu', 2],
  ['teresina', 2],
];

const pad = (value: number, size: number) => String(value).padStart(size, '0');
const fakeRoot = (index: number) => `FK${pad(index, 6)}`;
const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** CNPJ completo (14) a partir da raiz e da ordem. */
export function fakeCnpj(root: string, order = '0001'): string {
  const base = `${root}${order}`;
  return `${base}${cnpjCheckDigits(base)}`;
}

function buildDataset() {
  const establishments: FakeEstablishment[] = [];
  const companies: FakeCompany[] = [];
  let index = 0;
  for (const [cityKey, count] of PER_CITY) {
    const city = CITIES[cityKey]!;
    for (let i = 0; i < count; i += 1) {
      index += 1;
      const name = NAMES[(index - 1) % NAMES.length]!;
      const tradeName = PATTERNS[index % PATTERNS.length]!(name);
      const root = fakeRoot(index);
      const local = pad(index, 4);
      establishments.push({
        root,
        order: '0001',
        tradeName,
        status: '02',
        cnaeMain: index % 5 === 0 ? '6920602' : '6920601',
        cnaesSecondary: index % 3 === 0 ? ['8211300', '7020400'] : [],
        city,
        street: `RUA FICTÍCIA ${name}`,
        number: index % 7 === 0 ? 'S/N' : String(100 + index),
        neighborhood: 'CENTRO',
        postalCode: `${city.ddd === '86' ? '64' : '62'}${pad(index, 6)}`,
        // Alguns sem telefone ou sem e-mail, como na base real.
        phone: index % 6 === 0 ? null : `${city.ddd}3611${local}`,
        phone2: index % 4 === 0 ? `${city.ddd}99990${local}` : null,
        email: index % 5 === 4 ? null : `contato@${slug(name)}-contabil.example`,
        openedAt: `20${pad(5 + (index % 15), 2)}0${(index % 9) + 1}15`,
      });
      companies.push({
        root,
        name: `${tradeName} LTDA`,
        nature: index % 4 === 0 ? '2240' : '2062',
        size: index % 3 === 0 ? '03' : '01',
      });
    }
  }
  const sobral = CITIES.sobral!;
  const fortaleza = CITIES.fortaleza!;
  const exception = (
    root: string,
    overrides: Partial<FakeEstablishment>,
    company: Omit<FakeCompany, 'root'>,
  ) => {
    establishments.push({
      root,
      order: '0001',
      tradeName: '',
      status: '02',
      cnaeMain: '6920601',
      cnaesSecondary: [],
      city: sobral,
      street: 'AVENIDA FICTÍCIA',
      number: '10',
      neighborhood: 'CENTRO',
      postalCode: '62010000',
      phone: null,
      phone2: null,
      email: null,
      openedAt: '20100101',
      ...overrides,
    });
    if (!companies.some((c) => c.root === root)) companies.push({ root, ...company });
  };
  // Filial de um escritório de Sobral, em Fortaleza.
  exception(
    fakeRoot(1),
    {
      order: '0002',
      tradeName: 'CONTABILIDADE ALFA FILIAL FORTALEZA',
      city: fortaleza,
      phone: '8532310001',
      email: 'fortaleza@alfa-contabil.example',
    },
    { name: '', nature: '2062', size: '01' },
  );
  // Baixado: fica de fora.
  exception(
    fakeRoot(901),
    { tradeName: 'CONTABILIDADE ENCERRADA FICTÍCIA', status: '08' },
    { name: 'CONTABILIDADE ENCERRADA FICTICIA LTDA', nature: '2062', size: '01' },
  );
  // Contabilidade só como atividade secundária: fica de fora no padrão.
  exception(
    fakeRoot(902),
    {
      tradeName: 'PAPELARIA E CONTABILIDADE FICTÍCIA',
      cnaeMain: '4761003',
      cnaesSecondary: ['6920601'],
      phone: '8836119020',
    },
    { name: 'PAPELARIA FICTICIA LTDA', nature: '2062', size: '01' },
  );
  // Empresário individual (dados de uma pessoa): fora no padrão; o CPF fictício some do nome.
  exception(
    fakeRoot(903),
    { tradeName: '', phone: '88999900903', email: 'maria.ficticia@contabil.example' },
    { name: 'MARIA FICTICIA DE SOUSA 12345678909', nature: '2135', size: '01' },
  );
  // Cidade sem correspondência no IBGE.
  exception(
    fakeRoot(904),
    {
      tradeName: 'CONTABILIDADE DO SERTÃO FICTÍCIO',
      city: CITIES.ficticia!,
      phone: '8836119040',
    },
    { name: 'CONTABILIDADE DO SERTAO FICTICIO LTDA', nature: '2062', size: '01' },
  );
  // Outras atividades (a grande maioria da base real): nada disso entra.
  for (let i = 0; i < 6; i += 1) {
    exception(
      fakeRoot(950 + i),
      { tradeName: `PADARIA FICTÍCIA ${NAMES[i]}`, cnaeMain: '1091101', phone: null },
      { name: `PADARIA FICTICIA ${NAMES[i]} LTDA`, nature: '2062', size: '01' },
    );
  }
  // Empresas sem estabelecimento de contabilidade (a segunda passagem as ignora).
  for (let i = 0; i < 5; i += 1) {
    companies.push({
      root: fakeRoot(980 + i),
      name: `COMÉRCIO FICTÍCIO ${i}`,
      nature: '2062',
      size: '05',
    });
  }
  return { establishments, companies };
}

function establishmentLine(e: FakeEstablishment): string {
  const phone = (value: string | null) => (value ? [value.slice(0, 2), value.slice(2)] : ['', '']);
  const [ddd1, tel1] = phone(e.phone);
  const [ddd2, tel2] = phone(e.phone2);
  const cnpj = fakeCnpj(e.root, e.order);
  const [streetType, ...street] = e.street.split(' ');
  return receitaCsvLine([
    e.root,
    e.order,
    cnpj.slice(12),
    e.order === '0001' ? '1' : '2',
    e.tradeName,
    e.status,
    '20200101',
    e.status === '02' ? '00' : '01',
    '',
    '',
    e.openedAt,
    e.cnaeMain,
    e.cnaesSecondary.join(','),
    streetType!,
    street.join(' '),
    e.number,
    '',
    e.neighborhood,
    e.postalCode,
    e.city.uf,
    e.city.receita,
    ddd1!,
    tel1!,
    ddd2!,
    tel2!,
    '',
    '',
    e.email ?? '',
    '',
    '',
  ]);
}

export interface FakeRegistryOptions {
  /** Mês publicado (padrão: 2026-09). */
  reference?: string;
  /** Falha uma vez no meio deste arquivo (testes de retomada). */
  failOnceOn?: string;
}

export class FakeCompanyRegistrySource implements CompanyRegistrySource {
  readonly name = 'fake';
  /** Arquivos abertos, para os testes conferirem a retomada. */
  readonly opened: string[] = [];
  private reference: string;
  private failOnceOn: string | null;
  private readonly files: Map<string, string>;

  constructor(options: FakeRegistryOptions = {}) {
    this.reference = options.reference ?? '2026-09';
    this.failOnceOn = options.failOnceOn ?? null;
    const { establishments, companies } = buildDataset();
    const half = Math.ceil(establishments.length / 2);
    const lines = (items: string[]) => `${items.join('\r\n')}\r\n`;
    this.files = new Map([
      ['Estabelecimentos0.zip', lines(establishments.slice(0, half).map(establishmentLine))],
      ['Estabelecimentos1.zip', lines(establishments.slice(half).map(establishmentLine))],
      [
        'Empresas0.zip',
        lines(
          companies.map((c) =>
            receitaCsvLine([c.root, c.name, c.nature, '49', '1000,00', c.size, '']),
          ),
        ),
      ],
      [
        'Municipios.zip',
        lines(Object.values(CITIES).map((c) => receitaCsvLine([c.receita, c.name]))),
      ],
    ]);
  }

  /** Para mudar o mês publicado no meio de um teste. */
  publish(reference: string) {
    this.reference = reference;
  }

  async latestReference(): Promise<string> {
    return this.reference;
  }

  async listFiles(reference: string): Promise<RegistryFile[]> {
    if (reference !== this.reference) {
      throw new CompanyRegistryError(`Mês ${reference} não publicado.`, 'NOT_PUBLISHED');
    }
    return [
      { name: 'Municipios.zip', kind: 'MUNICIPALITIES' },
      { name: 'Estabelecimentos0.zip', kind: 'ESTABLISHMENTS' },
      { name: 'Estabelecimentos1.zip', kind: 'ESTABLISHMENTS' },
      { name: 'Empresas0.zip', kind: 'COMPANIES' },
    ];
  }

  async *open(reference: string, file: RegistryFile): AsyncIterable<Uint8Array> {
    if (reference !== this.reference) {
      throw new CompanyRegistryError(`Mês ${reference} não publicado.`, 'NOT_PUBLISHED');
    }
    const content = this.files.get(file.name);
    if (content === undefined) {
      throw new CompanyRegistryError(`Arquivo ${file.name} não encontrado.`, 'NOT_PUBLISHED');
    }
    this.opened.push(file.name);
    const bytes = encodeLatin1(content);
    const fail = this.failOnceOn === file.name;
    // Pedaços pequenos, cortando linhas e caracteres no meio, como na rede.
    for (let offset = 0; offset < bytes.length; offset += 97) {
      if (fail && offset > bytes.length / 2) {
        this.failOnceOn = null;
        throw new CompanyRegistryError('Conexão caída (simulada).', 'UNAVAILABLE');
      }
      yield bytes.slice(offset, offset + 97);
    }
  }
}
