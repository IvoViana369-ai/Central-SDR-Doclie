import { toSearchKey } from '../../normalization';

/**
 * Detecção determinística de opt-out em respostas (docs/SDR-FLOW.md §7, regra
 * 1): roda antes de qualquer classificação.
 *
 * - **CERTAIN:** a resposta é a própria palavra ("SAIR", "Parar.") ou contém
 *   uma expressão de várias palavras ("não quero receber", "me tire da lista").
 *   Vale na hora: Lista Não Contatar e cadência encerrada.
 * - **POSSIBLE:** uma palavra isolada aparece no meio de um texto maior ("vou
 *   sair mais cedo"). A pessoa decide; o sistema não presume.
 */

export type OptOutLevel = 'CERTAIN' | 'POSSIBLE' | 'NONE';

export interface OptOutDetection {
  level: OptOutLevel;
  /** Expressão encontrada (como configurada). */
  match: string | null;
}

/** Uma palavra só, curta, é tratada como "a resposta inteira" até este tamanho (em palavras). */
const SHORT_REPLY_WORDS = 3;

const containsPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

export function detectOptOut(text: string, keywords: readonly string[]): OptOutDetection {
  const normalized = toSearchKey(text);
  if (!normalized) return { level: 'NONE', match: null };
  const words = normalized.split(' ');
  let possible: string | null = null;

  for (const keyword of keywords) {
    const key = toSearchKey(keyword);
    if (!key) continue;
    if (key.includes(' ')) {
      if (containsPhrase(normalized, key)) return { level: 'CERTAIN', match: keyword };
      continue;
    }
    if (!words.includes(key)) continue;
    // "SAIR", "sair por favor", "pare!" → a resposta é o pedido.
    if (words.length <= SHORT_REPLY_WORDS) return { level: 'CERTAIN', match: keyword };
    possible ??= keyword;
  }
  return possible ? { level: 'POSSIBLE', match: possible } : { level: 'NONE', match: null };
}
