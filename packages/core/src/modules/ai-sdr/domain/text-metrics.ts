import { toSearchKey } from '../../normalization';

const words = (text: string) => toSearchKey(text).split(' ').filter(Boolean);

/**
 * Quanto o humano alterou o rascunho (docs/AI-SDR.md §11): distância de edição
 * por palavras dividida pelo tamanho do maior texto. 0 = igual, 1 = tudo novo.
 * Por palavras e sem acento/caixa: trocar "Olá" por "Ola" não conta como edição.
 */
export function editDistanceRatio(generated: string, final: string): number {
  const a = words(generated);
  const b = words(final);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return Math.round((previous[b.length]! / longest) * 1000) / 1000;
}

function shingles(text: string, size = 3): Set<string> {
  const list = words(text);
  if (list.length < size) return new Set(list.length ? [list.join(' ')] : []);
  const set = new Set<string>();
  for (let i = 0; i + size <= list.length; i++) set.add(list.slice(i, i + size).join(' '));
  return set;
}

/** Tira palavras com inicial maiúscula (nomes, cidades, início de frase). */
const withoutCapitalized = (text: string) =>
  text
    .split(/\s+/)
    .filter((w) => !/^[^\p{L}]*\p{Lu}/u.test(w))
    .join(' ');

/**
 * Similaridade de modelo (0 a 1) para detectar envio em massa: Jaccard entre
 * trincas de palavras, ignorando as de inicial maiúscula. Um mesmo texto com
 * outro nome de escritório, pessoa ou cidade dá 1.
 */
export function textSimilarity(a: string, b: string): number {
  const sa = shingles(withoutCapitalized(a));
  const sb = shingles(withoutCapitalized(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const s of sa) if (sb.has(s)) common += 1;
  return common / (sa.size + sb.size - common);
}
