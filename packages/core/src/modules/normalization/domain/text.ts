import { toSearchKey } from '@docline/db/search-key';
import { fail, ok, type Normalized } from './result';

export { toSearchKey };

/** Remove espaços nas pontas e repetidos no meio. Capitalização fica para a Fase 3. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Termos genéricos de nomes de empresas do setor, ignorados na comparação de
 * nomes (similaridade, Fase 3): "Escritório Contábil Silva Ltda" → "silva".
 */
const GENERIC_TERMS = new Set([
  'contabilidade',
  'contabil',
  'contabeis',
  'contadores',
  'contador',
  'assessoria',
  'consultoria',
  'escritorio',
  'organizacao',
  'organizacoes',
  'servicos',
  'empresarial',
  'empresariais',
  'associados',
  'auditoria',
  'gestao',
  'ltda',
  'me',
  'epp',
  'eireli',
  'mei',
  'sa',
  'ss',
  'cia',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
]);

/** Núcleo do nome: chave de busca sem termos genéricos (ou a chave inteira, se só houver termos genéricos). */
export function nameCore(value: string): string {
  const key = toSearchKey(value);
  const core = key
    .split(' ')
    .filter((word) => !GENERIC_TERMS.has(word))
    .join(' ');
  return core || key;
}

/** CEP com 8 dígitos. */
export function normalizePostalCode(raw: string): Normalized<string> {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return fail('EMPTY', 'Informe o CEP.');
  if (digits.length !== 8) return fail('INVALID_LENGTH', 'CEP deve ter 8 dígitos.');
  return ok(digits);
}

export function formatPostalCode(cep: string): string {
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}
