import { fail, ok, type Normalized } from './result';
import { cleanText, toSearchKey } from './text';

/** UFs pela chave de busca do nome ("ceara" → "CE"). */
const UF_BY_NAME: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};
export const UFS: ReadonlySet<string> = new Set(Object.values(UF_BY_NAME));

/** "ce", "CE", "Ceará", "ceara" → "CE". */
export function normalizeUf(raw: string): Normalized<string> {
  const key = toSearchKey(raw);
  if (key.length === 0) return fail('EMPTY', 'Informe a UF.');
  const upper = key.toUpperCase();
  if (UFS.has(upper)) return ok(upper);
  const byName = UF_BY_NAME[key];
  return byName ? ok(byName) : fail('INVALID_UF', `UF "${cleanText(raw)}" não existe.`);
}

/**
 * Cidade com a UF no mesmo texto: "Sobral - CE", "Sobral/CE", "Sobral (CE)",
 * "Sobral CE", "Sobral, Ceará". O nome da UF por extenso só conta depois de
 * um separador explícito ("Bom Jesus do Tocantins" é uma cidade).
 */
export function parseCityState(raw: string): { city: string; uf: string | null } {
  const text = cleanText(raw);
  const sigla = /^(.+?)[\s,/(-]+([A-Za-z]{2})\)?$/.exec(text);
  if (sigla && UFS.has(sigla[2]!.toUpperCase())) {
    return { city: sigla[1]!.trim(), uf: sigla[2]!.toUpperCase() };
  }
  // Hífen só separa com espaços ("Ji-Paraná" é uma cidade de RO).
  const named = /^(.+?)\s*(?:\s-\s|[/,(])\s*([^/,(]+?)\)?$/.exec(text);
  if (named) {
    const uf = normalizeUf(named[2]!);
    if (uf.ok) return { city: named[1]!.trim(), uf: uf.value };
  }
  return { city: text, uf: null };
}

/** Abreviações comuns em nomes de cidade nas planilhas. */
const CITY_ABBREVIATIONS: [RegExp, string][] = [
  [/^sta\b/, 'santa'],
  [/^sto\b/, 'santo'],
  [/^s\b/, 'sao'],
  [/^n\s?sra\b/, 'nossa senhora'],
];

export interface MunicipalityRef {
  ibgeCode: number;
  name: string;
  uf: string;
  /** Chave de busca do nome (`municipalities.name_search`). */
  nameSearch: string;
  ddd: number | null;
}

export type MunicipalityMatch =
  | { status: 'MATCHED'; municipality: MunicipalityRef }
  /** Mesmo nome em mais de uma UF e nenhuma UF informada. */
  | { status: 'AMBIGUOUS'; candidates: MunicipalityRef[] }
  | { status: 'NOT_FOUND' };

/**
 * Casamento de cidade com o cadastro do IBGE em memória (5.571 municípios),
 * para não consultar o banco linha a linha na importação.
 */
export class MunicipalityIndex {
  private readonly byName = new Map<string, MunicipalityRef[]>();

  constructor(municipalities: MunicipalityRef[]) {
    for (const m of municipalities) {
      const list = this.byName.get(m.nameSearch);
      if (list) list.push(m);
      else this.byName.set(m.nameSearch, [m]);
    }
  }

  match(cityRaw: string, ufRaw?: string | null): MunicipalityMatch {
    const parsed = parseCityState(cityRaw);
    const ufFromColumn = ufRaw ? normalizeUf(ufRaw) : null;
    const uf = ufFromColumn?.ok ? ufFromColumn.value : parsed.uf;
    let key = toSearchKey(parsed.city);
    // O texto inteiro também pode ser o nome ("Ji-Paraná", "Rio de Janeiro").
    let candidates = this.byName.get(key) ?? this.byName.get(toSearchKey(cityRaw));
    if (!candidates) {
      for (const [pattern, replacement] of CITY_ABBREVIATIONS) {
        if (pattern.test(key)) {
          key = key.replace(pattern, replacement);
          candidates = this.byName.get(key);
          break;
        }
      }
    }
    if (!candidates) return { status: 'NOT_FOUND' };
    const inUf = uf ? candidates.filter((c) => c.uf === uf) : candidates;
    if (inUf.length === 1) return { status: 'MATCHED', municipality: inUf[0]! };
    if (inUf.length === 0) return { status: 'NOT_FOUND' };
    return { status: 'AMBIGUOUS', candidates: inUf };
  }
}
