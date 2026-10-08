import { fail, ok, type Normalized } from './result';

/**
 * CNPJ numérico e alfanumérico (IN RFB nº 2.229/2024, novos CNPJs a partir de
 * julho de 2026): 12 posições com letras maiúsculas ou dígitos e 2 dígitos
 * verificadores numéricos. O cálculo do DV é o mesmo do CNPJ numérico, usando
 * para cada caractere o valor do código ASCII menos 48 (0–9 → 0–9, A → 17…).
 */

export interface NormalizedCnpj {
  /** 14 caracteres, sem pontuação, letras em maiúsculas. */
  cnpj: string;
  /** Raiz (8 primeiras posições): identifica a empresa; o restante, o estabelecimento. */
  root: string;
  isAlphanumeric: boolean;
}

const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (base.charCodeAt(i) - 48) * weights[i]!;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function normalizeCnpj(raw: string): Normalized<NormalizedCnpj> {
  const cnpj = raw.replace(/[\s./-]/g, '').toUpperCase();
  if (cnpj.length === 0) return fail('EMPTY', 'Informe o CNPJ.');
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) {
    return fail(
      'INVALID_FORMAT',
      'CNPJ deve ter 14 caracteres (12 letras ou números e 2 dígitos).',
    );
  }
  if (/^(.)\1{13}$/.test(cnpj)) return fail('INVALID_CHECK_DIGIT', 'CNPJ inválido.');

  const first = checkDigit(cnpj, FIRST_WEIGHTS);
  const second = checkDigit(cnpj.slice(0, 12) + String(first), SECOND_WEIGHTS);
  if (cnpj.slice(12) !== `${first}${second}`) {
    return fail('INVALID_CHECK_DIGIT', 'CNPJ inválido (dígitos verificadores não conferem).');
  }
  return ok({ cnpj, root: cnpj.slice(0, 8), isAlphanumeric: /[A-Z]/.test(cnpj) });
}

/** Exibição: "12ABC34501DE35" → "12.ABC.345/01DE-35". */
export function formatCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
