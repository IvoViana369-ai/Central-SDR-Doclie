import {
  formatName,
  normalizeCnpj,
  normalizeEmail,
  normalizePhone,
  toSearchKey,
} from '../../normalization';

/**
 * Leitura dos arquivos da base aberta do CNPJ (layout da Receita Federal):
 * CSV com `;`, campos entre aspas, Latin-1, sem cabeçalho, datas AAAAMMDD.
 * Só três arquivos são usados: Estabelecimentos (30 colunas), Empresas (7) e
 * Municípios (2). Sócios e Simples não são lidos.
 */

/** Atividades de contabilidade (6920-6/01) e de consultoria e auditoria contábil e tributária (6920-6/02). */
export const ACCOUNTING_CNAES = ['6920601', '6920602'] as const;

/** Situação cadastral "ativa" no layout da Receita. */
const ACTIVE_STATUS = '02';

const ESTABLISHMENT_COLUMNS = 30;
const COMPANY_COLUMNS = 7;

/** Colunas de Estabelecimentos usadas (posição no arquivo, a partir de 0). */
const E = {
  root: 0,
  order: 1,
  dv: 2,
  headOffice: 3,
  tradeName: 4,
  status: 5,
  openedAt: 10,
  cnaeMain: 11,
  cnaesSecondary: 12,
  streetType: 13,
  street: 14,
  number: 15,
  complement: 16,
  neighborhood: 17,
  postalCode: 18,
  uf: 19,
  municipality: 20,
  ddd1: 21,
  phone1: 22,
  ddd2: 23,
  phone2: 24,
  email: 27,
} as const;

/** Colunas de Empresas usadas. */
const C = { root: 0, companyName: 1, legalNature: 2, size: 5 } as const;

/**
 * Separa uma linha nos campos. Aspas duplas dentro de um campo vêm dobradas;
 * uma aspa solta no meio do texto (acontece na base) fica como está.
 */
export function splitReceitaLine(line: string): string[] {
  const fields: string[] = [];
  const n = line.length;
  let i = 0;
  for (;;) {
    let value = '';
    if (line[i] === '"') {
      i += 1;
      while (i < n) {
        const c = line[i]!;
        if (c === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          if (i + 1 === n || line[i + 1] === ';') {
            i += 1;
            break;
          }
        }
        value += c;
        i += 1;
      }
    } else {
      const next = line.indexOf(';', i);
      const end = next === -1 ? n : next;
      value = line.slice(i, end);
      i = end;
    }
    fields.push(value.trim());
    if (i >= n || line[i] !== ';') return fields;
    i += 1;
  }
}

/** Filtro rápido antes de separar a linha (a maioria das linhas não é de contabilidade). */
export function mayBeAccountingLine(line: string): boolean {
  return line.includes('692060');
}

/** "20150310" → data (UTC). "0", "00000000" ou inválida → null. */
export function parseReceitaDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value) || value === '00000000') return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1900) return null;
  return date;
}

function optional(value: string | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
}

function phoneOf(ddd: string | undefined, number: string | undefined): string | null {
  const d = (ddd ?? '').replace(/\D/g, '');
  const n = (number ?? '').replace(/\D/g, '');
  if (!d || !n) return null;
  const normalized = normalizePhone(`(${d.slice(-2)}) ${n}`);
  // Números de serviço (0800…) não servem de contato com o escritório.
  return normalized.ok && normalized.value.kind !== 'SERVICE' ? normalized.value.e164 : null;
}

function emailOf(value: string | undefined): string | null {
  const text = optional(value);
  if (!text) return null;
  const normalized = normalizeEmail(text);
  return normalized.ok ? normalized.value.email : null;
}

/** Estabelecimento lido (antes do município do IBGE e dos dados da empresa). */
export interface ReceitaEstablishment {
  cnpj: string;
  cnpjRoot: string;
  isHeadOffice: boolean;
  tradeName: string | null;
  cnaeMain: string;
  cnaesSecondary: string[];
  openedAt: Date | null;
  uf: string;
  receitaMunicipalityCode: number;
  addressLine: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  phone1: string | null;
  phone2: string | null;
  email: string | null;
}

export interface EstablishmentFilter {
  /** Também quem tem a contabilidade só como atividade secundária. */
  includeSecondaryCnae: boolean;
}

export type EstablishmentParse =
  | { kind: 'kept'; establishment: ReceitaEstablishment }
  /** Fora do recorte (inativo, outra atividade, exterior). */
  | { kind: 'skipped' }
  /** Linha fora do layout ou CNPJ inválido. */
  | { kind: 'invalid' };

/** Lê uma linha de Estabelecimentos e aplica o recorte (ativos de contabilidade). */
export function parseEstablishmentLine(
  line: string,
  filter: EstablishmentFilter,
): EstablishmentParse {
  const f = splitReceitaLine(line);
  if (f.length !== ESTABLISHMENT_COLUMNS) return { kind: 'invalid' };
  const status = f[E.status]!.padStart(2, '0');
  if (status !== ACTIVE_STATUS) return { kind: 'skipped' };
  const cnaeMain = f[E.cnaeMain]!;
  const cnaesSecondary = f[E.cnaesSecondary]!.split(',')
    .map((c) => c.trim())
    .filter((c) => /^\d{7}$/.test(c));
  const accounting = (c: string) => (ACCOUNTING_CNAES as readonly string[]).includes(c);
  const target =
    accounting(cnaeMain) || (filter.includeSecondaryCnae && cnaesSecondary.some(accounting));
  if (!target) return { kind: 'skipped' };
  const uf = f[E.uf]!.toUpperCase();
  // Estabelecimento no exterior (UF "EX") não é público da prospecção.
  if (!/^[A-Z]{2}$/.test(uf) || uf === 'EX') return { kind: 'skipped' };

  const cnpj = normalizeCnpj(`${f[E.root]}${f[E.order]}${f[E.dv]}`);
  const municipality = Number(f[E.municipality]);
  if (!cnpj.ok || !Number.isInteger(municipality) || municipality <= 0) {
    return { kind: 'invalid' };
  }
  const streetType = optional(f[E.streetType]);
  const street = optional(f[E.street]);
  const number = optional(f[E.number]);
  const postal = (f[E.postalCode] ?? '').replace(/\D/g, '');
  const tradeName = optional(f[E.tradeName]);
  return {
    kind: 'kept',
    establishment: {
      cnpj: cnpj.value.cnpj,
      cnpjRoot: cnpj.value.root,
      isHeadOffice: f[E.headOffice] === '1',
      tradeName: tradeName ? formatName(tradeName) : null,
      cnaeMain,
      cnaesSecondary,
      openedAt: parseReceitaDate(f[E.openedAt]!),
      uf,
      receitaMunicipalityCode: municipality,
      addressLine: street ? formatName([streetType, street].filter(Boolean).join(' ')) : null,
      addressNumber: number && /^s\/?n$/i.test(number) ? 'S/N' : number,
      addressComplement: optional(f[E.complement]),
      neighborhood: optional(f[E.neighborhood]) ? formatName(f[E.neighborhood]!) : null,
      postalCode: postal.length === 8 ? postal : null,
      phone1: phoneOf(f[E.ddd1], f[E.phone1]),
      phone2: phoneOf(f[E.ddd2], f[E.phone2]),
      email: emailOf(f[E.email]),
    },
  };
}

/**
 * Natureza jurídica de pessoa natural: empresário individual (213-5) e o
 * grupo 4 da tabela (pessoas físicas). Os dados desses CNPJs são de uma pessoa.
 */
export function isIndividualNature(code: string | null): boolean {
  if (!code) return false;
  return code === '2135' || code.startsWith('4');
}

/**
 * A razão social de empresário individual costuma trazer o CPF no fim
 * ("MARIA DA SILVA 12345678909"). O CPF não é guardado.
 */
export function stripCpfFromName(name: string): string {
  return name
    .replace(/\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ReceitaCompany {
  cnpjRoot: string;
  companyName: string | null;
  legalNature: string | null;
  isIndividualEntrepreneur: boolean;
  /** 00 não informado, 01 microempresa, 03 pequeno porte, 05 demais. */
  companySize: string | null;
}

/** Lê uma linha de Empresas (só a raiz, para conferir se interessa, antes do resto). */
export function companyRootOf(line: string): string | null {
  const match = /^"?([0-9A-Za-z]{8})"?;/.exec(line);
  return match ? match[1]!.toUpperCase() : null;
}

export function parseCompanyLine(line: string): ReceitaCompany | null {
  const f = splitReceitaLine(line);
  if (f.length !== COMPANY_COLUMNS || !/^[0-9A-Z]{8}$/i.test(f[C.root]!)) return null;
  const nature = /^\d{4}$/.test(f[C.legalNature]!) ? f[C.legalNature]! : null;
  const rawName = optional(f[C.companyName]);
  const name = rawName ? stripCpfFromName(rawName) : null;
  const size = /^\d{1,2}$/.test(f[C.size]!) ? f[C.size]!.padStart(2, '0') : null;
  return {
    cnpjRoot: f[C.root]!.toUpperCase(),
    companyName: name ? formatName(name) : null,
    legalNature: nature,
    isIndividualEntrepreneur: isIndividualNature(nature),
    companySize: size,
  };
}

/** Lê uma linha de Municípios: código da Receita e o nome. */
export function parseMunicipalityLine(line: string): { code: number; name: string } | null {
  const f = splitReceitaLine(line);
  const code = Number(f[0]);
  const name = optional(f[1]);
  if (f.length !== 2 || !Number.isInteger(code) || code <= 0 || !name) return null;
  return { code, name };
}

/** Nome para busca: nome fantasia ou, sem ele, a razão social. */
export function registryNameSearch(tradeName: string | null, companyName: string | null): string {
  return toSearchKey(tradeName ?? companyName ?? '');
}

export const COMPANY_SIZE_LABELS: Record<string, string> = {
  '00': 'Não informado',
  '01': 'Microempresa',
  '03': 'Empresa de pequeno porte',
  '05': 'Demais',
};

/** Ajuda dos testes e do simulador: monta uma linha no formato da Receita. */
export function receitaCsvLine(fields: readonly (string | number | null)[]): string {
  return fields.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';');
}

/** Codifica texto em Latin-1 (caracteres fora dele viram "?"), como os arquivos da Receita. */
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}

/** Linhas de um arquivo em Latin-1 entregue em pedaços (sem carregar tudo na memória). */
export async function* readLatin1Lines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('latin1');
  let pending = '';
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true });
    let start = 0;
    let index = pending.indexOf('\n', start);
    while (index !== -1) {
      const line = pending.slice(start, index).replace(/\r$/, '');
      if (line.length > 0) yield line;
      start = index + 1;
      index = pending.indexOf('\n', start);
    }
    pending = pending.slice(start);
  }
  pending += decoder.decode();
  const last = pending.replace(/\r$/, '');
  if (last.length > 0) yield last;
}
