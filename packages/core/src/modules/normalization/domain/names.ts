import { cleanText } from './text';

/**
 * Nomes de pessoas e empresas (docs/MVP.md M05): espaços, capitalização e
 * siglas. Só reescreve a capitalização quando o texto veio todo em
 * maiúsculas ou todo em minúsculas, como é comum em planilhas exportadas;
 * "McDonald" ou "iFood", digitados de propósito, ficam como estão.
 */

/** Preposições e artigos que ficam em minúsculas no meio do nome. */
const PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'em']);

/** Siglas que ficam em maiúsculas. */
const ACRONYMS = new Set([
  'ME',
  'EPP',
  'EIRELI',
  'MEI',
  'SA',
  'S/A',
  'S.A.',
  'SS',
  'S/S',
  'CRC',
  'BPO',
  'TI',
  'RH',
  'DP',
  'CNPJ',
  'CPF',
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
]);

function capitalizeWord(word: string, first: boolean): string {
  const upper = word.toLocaleUpperCase('pt-BR');
  if (ACRONYMS.has(upper)) return upper;
  const lower = word.toLocaleLowerCase('pt-BR');
  if (!first && PARTICLES.has(lower)) return lower;
  if (upper === 'LTDA' || upper === 'LTDA.') return `Ltda${word.endsWith('.') ? '.' : ''}`;
  // "d'Ávila", "pau-brasil": capitaliza cada parte.
  return lower.replace(
    /(^|[-'’])(\p{L})/gu,
    (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase('pt-BR'),
  );
}

/** "ESCRITÓRIO CONTÁBIL SILVA E SOUZA LTDA" → "Escritório Contábil Silva e Souza Ltda". */
export function formatName(value: string): string {
  const text = cleanText(value);
  const letters = text.replace(/[^\p{L}]/gu, '');
  const uniformCase =
    letters === letters.toLocaleUpperCase('pt-BR') ||
    letters === letters.toLocaleLowerCase('pt-BR');
  if (!uniformCase || letters.length === 0) return text;
  return text
    .split(' ')
    .map((word, index) => capitalizeWord(word, index === 0))
    .join(' ');
}

/**
 * Vários valores na mesma célula: "(88) 3611-0000 / (88) 99999-1111",
 * "a@x.com; b@x.com", "88 3611-0000 ou 88 99999-1111". A barra só separa
 * telefones (em links do Instagram ela faz parte do valor).
 */
export function splitList(value: string, options: { slash?: boolean } = {}): string[] {
  const separators = options.slash
    ? /[;,|\n\r/]+|\s+(?:e|ou)\s+/i
    : /[;,|\n\r]+|\s+\/\s+|\s+(?:e|ou)\s+/i;
  return value
    .split(separators)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
