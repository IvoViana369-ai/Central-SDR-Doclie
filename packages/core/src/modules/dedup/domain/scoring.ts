import type { DuplicateConfidence } from '@docline/db';

/**
 * Sinais de duplicidade e pesos (docs/MVP.md M06; ARCHITECTURE §12.2). Os
 * pesos combinam por "ou ruidoso": 1 − Π(1 − peso), então dois sinais médios
 * valem mais que um só, sem passar de 1.
 */
export type DuplicateRule =
  | 'CNPJ'
  | 'CNPJ_ROOT'
  | 'PHONE'
  | 'EMAIL'
  | 'EMAIL_FREE'
  | 'INSTAGRAM'
  | 'WEBSITE'
  | 'NAME_CITY'
  | 'NAME_SIMILAR';

export const RULE_WEIGHTS: Record<DuplicateRule, number> = {
  CNPJ: 1,
  PHONE: 0.8,
  EMAIL: 0.8,
  /** E-mail de provedor gratuito pesa menos (pode ser de um contador que atende vários escritórios). */
  EMAIL_FREE: 0.5,
  INSTAGRAM: 0.8,
  WEBSITE: 0.7,
  NAME_CITY: 0.6,
  /** Multiplicado pela similaridade (0–1) entre os núcleos dos nomes. */
  NAME_SIMILAR: 0.5,
  /** Filial: mesma raiz de CNPJ. Sinalizada à parte, com confiança baixa. */
  CNPJ_ROOT: 0.45,
};

export const RULE_LABELS: Record<DuplicateRule, string> = {
  CNPJ: 'Mesmo CNPJ',
  CNPJ_ROOT: 'Filial (mesma raiz de CNPJ)',
  PHONE: 'Mesmo telefone',
  EMAIL: 'Mesmo e-mail',
  EMAIL_FREE: 'Mesmo e-mail (provedor gratuito)',
  INSTAGRAM: 'Mesmo Instagram',
  WEBSITE: 'Mesmo site',
  NAME_CITY: 'Mesmo nome na mesma cidade',
  NAME_SIMILAR: 'Nome parecido na mesma cidade',
};

export interface DuplicateSignal {
  rule: DuplicateRule;
  /** Valor mascarado ou explicação curta (sem dado pessoal em claro). */
  detail: string;
  /** Peso efetivo (para NAME_SIMILAR, já multiplicado pela similaridade). */
  weight: number;
}

export const CONFIDENCE_LABELS: Record<DuplicateConfidence, string> = {
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
};

/** Score (0–1) e confiança de um par a partir dos sinais. */
export function scoreSignals(signals: DuplicateSignal[]): {
  score: number;
  confidence: DuplicateConfidence;
} {
  const best = new Map<DuplicateRule, number>();
  for (const s of signals) best.set(s.rule, Math.max(best.get(s.rule) ?? 0, s.weight));
  const only = [...best.keys()];
  const score =
    Math.round((1 - [...best.values()].reduce((acc, w) => acc * (1 - w), 1)) * 100) / 100;
  // Só a raiz do CNPJ (filial) nunca passa de confiança baixa.
  if (only.length === 1 && only[0] === 'CNPJ_ROOT') return { score, confidence: 'LOW' };
  const confidence: DuplicateConfidence = score >= 0.9 ? 'HIGH' : score >= 0.7 ? 'MEDIUM' : 'LOW';
  return { score, confidence };
}

/** Sinal com o peso padrão da regra. */
export const signal = (rule: DuplicateRule, detail: string, factor = 1): DuplicateSignal => ({
  rule,
  detail,
  weight: Math.round(RULE_WEIGHTS[rule] * factor * 100) / 100,
});
