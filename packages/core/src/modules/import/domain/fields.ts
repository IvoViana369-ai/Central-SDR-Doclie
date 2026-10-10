import { toSearchKey } from '../../normalization';

/**
 * Campos de destino da importação (docs/MVP.md M04) e sugestão automática de
 * mapeamento pelo nome da coluna: "Telefone comercial" → telefone, "Nome
 * Escritório" → nome fantasia, "Município" → cidade.
 */
export const IMPORT_FIELDS = {
  tradeName: { label: 'Nome fantasia', multiple: false },
  companyName: { label: 'Razão social', multiple: false },
  cnpj: { label: 'CNPJ', multiple: false },
  phone: { label: 'Telefone', multiple: true },
  whatsapp: { label: 'WhatsApp', multiple: true },
  email: { label: 'E-mail', multiple: true },
  instagram: { label: 'Instagram', multiple: true },
  website: { label: 'Site', multiple: false },
  city: { label: 'Cidade', multiple: false },
  state: { label: 'UF', multiple: false },
  postalCode: { label: 'CEP', multiple: false },
  addressLine: { label: 'Endereço', multiple: false },
  addressNumber: { label: 'Número', multiple: false },
  addressComplement: { label: 'Complemento', multiple: false },
  neighborhood: { label: 'Bairro', multiple: false },
  personName: { label: 'Pessoa de contato', multiple: false },
  personRole: { label: 'Cargo da pessoa', multiple: false },
  segment: { label: 'Segmento', multiple: false },
  category: { label: 'Categoria', multiple: false },
  description: { label: 'Observações', multiple: true },
  tags: { label: 'Tags', multiple: true },
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export const IMPORT_FIELD_KEYS = Object.keys(IMPORT_FIELDS) as ImportField[];

/** Destino de uma coluna: um campo do lead, um campo extra ou nada. */
export type ColumnTarget = ImportField | 'custom' | 'ignore';

export interface ColumnMapping {
  index: number;
  header: string;
  target: ColumnTarget;
  /** Nome do campo extra (`custom_fields`), quando `target = custom`. */
  customKey?: string;
}

/** Nomes de coluna conhecidos (chave de busca), do mais específico ao mais geral. */
const SYNONYMS: [ImportField, string[]][] = [
  ['companyName', ['razao social', 'nome empresarial', 'razao']],
  ['cnpj', ['cnpj', 'cnpj cpf', 'documento']],
  ['whatsapp', ['whatsapp', 'whats', 'wpp', 'zap', 'celular whatsapp', 'whatsapp comercial']],
  ['email', ['email', 'e mail', 'correio eletronico', 'endereco eletronico']],
  ['instagram', ['instagram', 'insta', 'ig', 'perfil instagram']],
  ['website', ['site', 'website', 'web site', 'url', 'pagina', 'home page', 'homepage']],
  ['postalCode', ['cep', 'codigo postal']],
  ['state', ['uf', 'estado', 'sigla uf']],
  ['city', ['cidade', 'municipio', 'localidade', 'cidade uf', 'municipio uf']],
  ['neighborhood', ['bairro']],
  ['addressNumber', ['numero', 'n', 'no', 'num']],
  ['addressComplement', ['complemento', 'compl']],
  ['addressLine', ['endereco', 'logradouro', 'rua', 'endereco completo']],
  ['personRole', ['cargo', 'funcao', 'cargo do contato']],
  [
    'personName',
    ['contato', 'nome do contato', 'responsavel', 'pessoa de contato', 'socio', 'contador'],
  ],
  ['segment', ['segmento']],
  ['category', ['categoria', 'ramo', 'atividade', 'tipo']],
  ['description', ['observacoes', 'observacao', 'obs', 'notas', 'comentarios', 'descricao']],
  ['tags', ['tags', 'tag', 'etiquetas']],
  [
    'phone',
    [
      'telefone',
      'fone',
      'tel',
      'celular',
      'telefone comercial',
      'telefone fixo',
      'contato telefone',
    ],
  ],
  [
    'tradeName',
    [
      'nome fantasia',
      'fantasia',
      'nome',
      'nome escritorio',
      'escritorio',
      'nome do escritorio',
      'empresa',
      'nome da empresa',
      'cliente',
      'lead',
    ],
  ],
];

/** Palavras que, no nome da coluna, indicam o campo (ex.: "Telefone 2 (comercial)"). */
const KEYWORDS: [ImportField, RegExp][] = [
  ['whatsapp', /\b(whats\w*|wpp|zap)\b/],
  ['email', /\be ?mail\b/],
  ['instagram', /\binsta(gram)?\b/],
  ['cnpj', /\bcnpj\b/],
  ['postalCode', /\bcep\b/],
  ['phone', /\b(telefone|fone|tel|celular|cel)\b/],
  ['companyName', /\brazao\b/],
  ['website', /\b(site|url)\b/],
  ['city', /\b(cidade|municipio)\b/],
  ['state', /\b(uf|estado)\b/],
  ['tradeName', /\b(fantasia|escritorio|empresa)\b/],
];

/** Sugestão para uma coluna, com o grau de certeza. */
export function suggestTarget(header: string): { target: ColumnTarget; exact: boolean } {
  const key = toSearchKey(header);
  if (!key) return { target: 'ignore', exact: false };
  for (const [field, names] of SYNONYMS) {
    if (names.includes(key)) return { target: field, exact: true };
  }
  for (const [field, pattern] of KEYWORDS) {
    if (pattern.test(key)) return { target: field, exact: false };
  }
  return { target: 'custom', exact: false };
}

/**
 * Mapeamento sugerido para o cabeçalho: campos de valor único ficam com a
 * primeira coluna (as demais viram campo extra); colunas sem nome são ignoradas.
 */
export function suggestMapping(headers: string[]): ColumnMapping[] {
  const used = new Set<ImportField>();
  return headers.map((header, index) => {
    const { target } = suggestTarget(header);
    if (target === 'custom' || target === 'ignore') {
      return target === 'custom'
        ? { index, header, target, customKey: customKeyOf(header) }
        : { index, header, target };
    }
    if (!IMPORT_FIELDS[target].multiple && used.has(target)) {
      return { index, header, target: 'custom', customKey: customKeyOf(header) };
    }
    used.add(target);
    return { index, header, target };
  });
}

/** Nome do campo extra a partir do cabeçalho ("Nº de funcionários" → "n_de_funcionarios"). */
export function customKeyOf(header: string): string {
  return toSearchKey(header).replace(/ /g, '_').slice(0, 60) || 'coluna';
}

/** Assinatura do cabeçalho, para reaproveitar um modelo de mapeamento salvo. */
export function headerSignature(headers: string[]): string {
  return headers.map((h) => toSearchKey(h)).join('|');
}

/**
 * Linha do cabeçalho: a primeira, entre as 10 primeiras com conteúdo, que tem
 * ao menos 2 células preenchidas e em que a maioria é texto (não número).
 */
export function detectHeaderRow(rows: { number: number; cells: string[] }[]): number {
  for (const row of rows.slice(0, 10)) {
    const filled = row.cells.filter((c) => c.trim() !== '');
    if (filled.length < 2) continue;
    const textual = filled.filter((c) => !/^[\d\s.,()+/-]+$/.test(c));
    if (textual.length / filled.length >= 0.6) return row.number;
  }
  return rows[0]?.number ?? 1;
}
