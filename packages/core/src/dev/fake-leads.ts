import type { LegalBasis } from '@docline/db';
import type { CreateLeadInput } from '../modules/leads';
import { cnpjCheckDigits, toSearchKey } from '../modules/normalization';

/**
 * Gerador de empresas fictícias para a base de desenvolvimento (F2-13).
 * Nada aqui é dado real:
 * - nomes de escritórios com palavras da natureza e da contabilidade, e
 *   pessoas com sobrenomes como "Exemplo" e "Teste";
 * - celulares na faixa 9 0XXX-XXXX (não usada pelas operadoras) e fixos
 *   iniciados por 2000;
 * - e-mails e sites no domínio reservado `.test` (RFC 2606);
 * - CNPJs alfanuméricos com raiz "ZZ", válidos só pelo dígito verificador.
 * Determinístico: o mesmo `seed` gera a mesma base.
 */

export interface FakeMunicipality {
  ibgeCode: number;
  uf: string;
  ddd: number | null;
  isCapital: boolean;
}

export interface FakeSource {
  id: string;
  key: string;
  defaultLegalBasis: LegalBasis;
}

export type FakeDuplicateKind =
  'PHONE_FORMAT' | 'EMAIL_CASE' | 'INSTAGRAM_URL' | 'SIMILAR_NAME' | 'CNPJ_BRANCH';

export interface FakeLeadPlan {
  input: Omit<CreateLeadInput, 'tagIds' | 'ownerId'>;
  tags: string[];
  note: string | null;
  /** Opt-out do lead inteiro ou só do primeiro telefone. */
  optOut: 'LEAD' | 'PHONE' | null;
  archive: boolean;
  /** Distribuir para um SDR (o seed escolhe quem). */
  assign: boolean;
  /** Duplicado proposital (para a revisão de duplicados da Fase 3). */
  duplicateOf: number | null;
  duplicateKind: FakeDuplicateKind | null;
}

export const FAKE_TAGS = ['Evento 2026', 'Parceiro', 'Prioridade', 'Retornar depois'] as const;
export const FAKE_EMAIL_DOMAIN = 'exemplo.test';

/** PRNG determinístico (mulberry32). */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability: number) => next() < probability,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}
type Random = ReturnType<typeof createRandom>;

const PREFIXES = [
  'Contabilidade',
  'Escritório Contábil',
  'Assessoria Contábil',
  'Organização Contábil',
  'Consultoria Contábil',
  'Gestão Contábil',
  'Centro Contábil',
  'Contadores Associados',
];
const ABBREVIATIONS: Record<string, string> = {
  Contabilidade: 'Contab.',
  'Escritório Contábil': 'Esc. Contabil',
  'Assessoria Contábil': 'Assessoria Contabil',
  'Organização Contábil': 'Org. Contábil',
  'Consultoria Contábil': 'Consult. Contábil',
  'Gestão Contábil': 'Gestao Contabil',
  'Centro Contábil': 'Centro Contabil',
  'Contadores Associados': 'Contadores Assoc.',
};
const WORDS = [
  'Ipê Amarelo',
  'Jatobá',
  'Sabiá',
  'Carnaúba',
  'Aroeira',
  'Mandacaru',
  'Buriti',
  'Juazeiro',
  'Jequitibá',
  'Araucária',
  'Cajueiro',
  'Bem-te-vi',
  'Juriti',
  'Seriema',
  'Graúna',
  'Tucano',
  'Arara Azul',
  'Beija-Flor',
  'Horizonte',
  'Alvorada',
  'Primavera',
  'Nascente',
  'Planalto',
  'Litoral',
  'Cerrado',
  'Caatinga',
  'Estrela Guia',
  'Bússola',
  'Âncora',
  'Farol',
  'Prisma',
  'Vértice',
  'Equilíbrio',
  'Balanço Certo',
  'Partida Dobrada',
  'Razão Clara',
  'Conta Certa',
  'Livro Caixa',
  'Ponto Contábil',
  'Exercício Fiscal',
];
const SUFFIXES = ['', '', '', ' Ltda', ' & Associados', ' S/S'];
const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elisa',
  'Fábio',
  'Gabriela',
  'Heitor',
  'Isabel',
  'João',
  'Karen',
  'Lucas',
  'Marina',
  'Nelson',
  'Olívia',
  'Paulo',
  'Rafael',
  'Sofia',
  'Tiago',
  'Vitória',
];
const LAST_NAMES = ['Exemplo', 'Teste', 'Modelo', 'Amostra', 'Demonstração'];
const ROLES = ['Sócio(a)', 'Contador(a) responsável', 'Gerente administrativo', 'Recepção'];
const NOTES = [
  'Atende principalmente MEIs e empresas do Simples.',
  'Pediu retorno no próximo mês.',
  'Controla tudo em planilhas; interesse em automação.',
  'Indicado em evento do setor.',
  'Tem equipe de 5 pessoas.',
];
/** UFs com mais leads fictícios (o resto se distribui pelas demais). */
const UF_WEIGHTS: [string, number][] = [
  ['CE', 22],
  ['SP', 20],
  ['MG', 10],
  ['RJ', 8],
  ['PR', 7],
  ['RS', 6],
  ['BA', 6],
  ['PE', 6],
  ['GO', 5],
  ['SC', 5],
  ['PB', 5],
];
const SOURCE_DETAILS: Record<string, string> = {
  GOOGLE: 'Busca no Google Maps',
  INSTAGRAM: 'Perfil encontrado no Instagram',
  EVENT: 'Feira de contabilidade 2026',
  CNPJ_OPEN_DATA: 'Dados abertos do CNPJ',
  THIRD_PARTY_LIST: 'Lista de associação do setor',
};

const pad = (n: number, size: number) => String(n).padStart(size, '0');
const slugOf = (name: string) =>
  toSearchKey(name)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 18);

function pickMunicipality(
  random: Random,
  byUf: Map<string, FakeMunicipality[]>,
  capitals: FakeMunicipality[],
) {
  if (capitals.length > 0 && random.chance(0.4)) return random.pick(capitals);
  const total = UF_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = random.next() * total;
  for (const [uf, weight] of UF_WEIGHTS) {
    roll -= weight;
    if (roll <= 0 && byUf.has(uf)) return random.pick(byUf.get(uf)!);
  }
  return random.pick([...byUf.values()].flat());
}

interface BaseIdentity {
  prefix: string;
  word: string;
  municipality: FakeMunicipality;
  cnpjBase: string | null;
  phone: { ddd: number; subscriber: string } | null;
  email: string | null;
  instagram: string | null;
}

function nameVariant(random: Random, base: BaseIdentity): string {
  const variants = [
    `${ABBREVIATIONS[base.prefix] ?? base.prefix} ${base.word}`,
    `${base.prefix} ${base.word}`.toUpperCase(),
    `${base.prefix} ${base.word} Ltda.`,
  ];
  return random.pick(variants);
}

/**
 * Gera `count` planos de cadastro. Cerca de 5% são duplicados propositais de
 * um lead anterior (mesmo telefone em outro formato, e-mail em maiúsculas,
 * Instagram por link, nome parecido na mesma cidade ou filial do mesmo CNPJ).
 */
export function generateFakeLeads(options: {
  count: number;
  seed: number;
  now: Date;
  municipalities: FakeMunicipality[];
  sources: FakeSource[];
  segmentIds: string[];
}): FakeLeadPlan[] {
  const random = createRandom(options.seed);
  const byUf = new Map<string, FakeMunicipality[]>();
  for (const m of options.municipalities) {
    if (m.ddd === null) continue;
    const list = byUf.get(m.uf);
    if (list) list.push(m);
    else byUf.set(m.uf, [m]);
  }
  const capitals = options.municipalities.filter((m) => m.isCapital && m.ddd !== null);
  const plans: FakeLeadPlan[] = [];
  /** Leads "originais" (não duplicados), com o índice do plano. */
  const bases: { identity: BaseIdentity; index: number }[] = [];

  const collectedAt = () =>
    new Date(options.now.getTime() - random.int(1, 365) * 86_400_000).toISOString().slice(0, 10);

  const extras = (): Omit<FakeLeadPlan, 'input' | 'duplicateOf' | 'duplicateKind'> => ({
    tags: FAKE_TAGS.filter(() => random.chance(0.15)),
    note: random.chance(0.15) ? random.pick(NOTES) : null,
    optOut: random.chance(0.03) ? 'LEAD' : random.chance(0.02) ? 'PHONE' : null,
    archive: random.chance(0.03),
    assign: random.chance(0.4),
  });

  for (let i = 0; i < options.count; i++) {
    const source = random.pick(options.sources);
    const origin = {
      sourceId: source.id,
      collectedAt: collectedAt(),
      detail: SOURCE_DETAILS[source.key] ?? null,
      referrerName: source.key === 'REFERRAL' ? `Cliente fictício ${i + 1}` : null,
    };
    const legalBasis = random.chance(0.1) ? 'NOT_ASSESSED' : source.defaultLegalBasis;

    if (i >= 20 && random.chance(0.05) && bases.length > 0) {
      const { identity: base, index } = random.pick(bases);
      const kinds: FakeDuplicateKind[] = ['SIMILAR_NAME'];
      if (base.phone) kinds.push('PHONE_FORMAT');
      if (base.email) kinds.push('EMAIL_CASE');
      if (base.instagram) kinds.push('INSTAGRAM_URL');
      if (base.cnpjBase) kinds.push('CNPJ_BRANCH');
      const kind = random.pick(kinds);
      const contactPoints: CreateLeadInput['contactPoints'] = [];
      let cnpj: string | null = null;
      if (kind === 'PHONE_FORMAT') {
        const { ddd, subscriber } = base.phone!;
        contactPoints.push({
          type: 'PHONE',
          value: `+55 ${ddd} ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`,
        });
      } else if (kind === 'EMAIL_CASE') {
        contactPoints.push({ type: 'EMAIL', value: base.email!.toUpperCase() });
      } else if (kind === 'INSTAGRAM_URL') {
        contactPoints.push({
          type: 'INSTAGRAM',
          value: `https://instagram.com/${base.instagram}/`,
        });
      } else if (kind === 'CNPJ_BRANCH') {
        const branch = `${base.cnpjBase!.slice(0, 8)}0002`;
        cnpj = `${branch}${cnpjCheckDigits(branch)}`;
      }
      plans.push({
        input: {
          tradeName: nameVariant(random, base),
          cnpj,
          municipalityCode: base.municipality.ibgeCode,
          origin,
          legalBasis,
          contactPoints,
          acknowledgeDuplicates: true,
        },
        ...extras(),
        duplicateOf: index,
        duplicateKind: kind,
      });
      continue;
    }

    const prefix = random.pick(PREFIXES);
    const word = random.pick(WORDS);
    const name = `${prefix} ${word}${random.pick(SUFFIXES)}`;
    const municipality = pickMunicipality(random, byUf, capitals);
    const ddd = municipality.ddd!;
    const slug = `${slugOf(word)}${i + 1}`;
    const contactPoints: CreateLeadInput['contactPoints'] = [];

    let phone: BaseIdentity['phone'] = null;
    if (random.chance(0.85)) {
      // Celular: 9 0 + 2 aleatórios + índice (único na base).
      const subscriber = `90${pad(random.int(0, 99), 2)}${pad(i, 5)}`;
      phone = { ddd, subscriber };
      const withoutDdd = random.chance(0.2);
      contactPoints.push({
        type: 'PHONE',
        value: withoutDdd
          ? `${subscriber.slice(0, 5)}-${subscriber.slice(5)}`
          : `(${ddd}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`,
        isWhatsapp: random.chance(0.6),
        isPrimary: true,
      });
    }
    if (random.chance(0.35)) {
      contactPoints.push({
        type: 'PHONE',
        value: `(${ddd}) 2000-${pad(i % 10_000, 4)}`,
        label: 'Fixo',
      });
    }
    const email = random.chance(0.6)
      ? `${random.pick(['contato', 'atendimento', 'financeiro', 'comercial'])}@${slug}.${FAKE_EMAIL_DOMAIN}`
      : null;
    if (email) contactPoints.push({ type: 'EMAIL', value: email });
    const instagram = random.chance(0.3) ? `${slugOf(word).slice(0, 14)}_${i + 1}` : null;
    if (instagram) contactPoints.push({ type: 'INSTAGRAM', value: `@${instagram}` });

    const people: NonNullable<CreateLeadInput['people']> = [];
    const peopleCount = random.chance(0.15) ? 2 : random.chance(0.5) ? 1 : 0;
    for (let p = 0; p < peopleCount; p++) {
      people.push({
        fullName: `${random.pick(FIRST_NAMES)} ${random.pick(LAST_NAMES)}`,
        roleTitle: random.pick(ROLES),
        isPrimary: p === 0,
        isDecisionMaker: p === 0 && random.chance(0.5),
      });
    }

    const cnpjBase = random.chance(0.45) ? `ZZ${pad(i, 6)}0001` : null;
    const leadType = random.chance(0.8)
      ? 'ACCOUNTING_FIRM'
      : random.pick(['ACCOUNTANT', 'REFERRAL_PARTNER', 'COMPANY'] as const);
    plans.push({
      input: {
        tradeName: name,
        companyName: random.chance(0.5) ? `${word} Serviços Contábeis Ltda` : null,
        leadType,
        cnpj: cnpjBase ? `${cnpjBase}${cnpjCheckDigits(cnpjBase)}` : null,
        segmentId:
          options.segmentIds.length > 0 && random.chance(0.7)
            ? random.pick(options.segmentIds)
            : null,
        municipalityCode: municipality.ibgeCode,
        website: random.chance(0.4) ? `https://www.${slug}.${FAKE_EMAIL_DOMAIN}` : null,
        origin,
        legalBasis,
        people,
        contactPoints,
        acknowledgeDuplicates: true,
      },
      ...extras(),
      duplicateOf: null,
      duplicateKind: null,
    });
    bases.push({
      identity: { prefix, word, municipality, cnpjBase, phone, email, instagram },
      index: i,
    });
  }
  return plans;
}
