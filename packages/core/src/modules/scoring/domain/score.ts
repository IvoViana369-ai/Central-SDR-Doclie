import type { ScoreBand, ScoreNormalization } from '@docline/db';
import { criterionOf, type ScoreFacts } from './criteria';

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  COLD: 'Frio',
  WARM: 'Morno',
  HOT: 'Quente',
  PRIORITY: 'Prioridade',
};

export const SCORE_BANDS: ScoreBand[] = ['COLD', 'WARM', 'HOT', 'PRIORITY'];

/** Por que o score foi recalculado (histórico na ficha do lead). */
const SCORE_TRIGGER_LABELS: Record<string, string> = {
  contact_state: 'Contatos ou situação de contato',
  'lead.update': 'Edição do lead',
  tag: 'Tags',
  'bulk.tag': 'Tags (ação em massa)',
  'priority_city.added': 'Cidade incluída nas prioritárias',
  'priority_city.removed': 'Cidade retirada das prioritárias',
  'model.activated': 'Nova versão do modelo',
  backfill: 'Cálculo inicial',
  reply: 'Resposta registrada',
};

export function scoreTriggerLabel(trigger: string): string {
  return SCORE_TRIGGER_LABELS[trigger] ?? 'Recálculo';
}

export const NORMALIZATION_LABELS: Record<ScoreNormalization, string> = {
  CLAMP: 'Soma com teto (0 a 100)',
  SCALE: 'Proporcional ao máximo possível',
};

export interface BandRange {
  band: ScoreBand;
  min: number;
  max: number;
}

export interface ScoringRuleInput {
  id?: string;
  criterionKey: string;
  params: unknown;
  points: number;
  active: boolean;
}

export interface ScoringModelInput {
  normalization: ScoreNormalization;
  bands: BandRange[];
  rules: ScoringRuleInput[];
}

export interface BreakdownItem {
  ruleId: string | null;
  criterion: string;
  label: string;
  matched: boolean;
  /** Pontos ganhos (0 quando não casou). */
  points: number;
  /** Peso da regra. */
  weight: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  /** Soma antes da normalização. */
  raw: number;
  breakdown: BreakdownItem[];
}

/**
 * Faixas válidas: as quatro, em ordem, cobrindo 0–100 sem buracos nem
 * sobreposição. Devolve as mensagens de erro (vazio = válido).
 */
export function validateBands(bands: BandRange[]): string[] {
  const errors: string[] = [];
  if (bands.length !== SCORE_BANDS.length || bands.some((b, i) => b.band !== SCORE_BANDS[i])) {
    return ['Informe as quatro faixas na ordem: Frio, Morno, Quente e Prioridade.'];
  }
  if (bands[0]!.min !== 0) errors.push('A primeira faixa começa em 0.');
  if (bands.at(-1)!.max !== 100) errors.push('A última faixa termina em 100.');
  bands.forEach((b, i) => {
    if (b.min > b.max) errors.push(`${SCORE_BAND_LABELS[b.band]}: mínimo maior que o máximo.`);
    const next = bands[i + 1];
    if (next && next.min !== b.max + 1) {
      errors.push(
        `${SCORE_BAND_LABELS[next.band]} deve começar em ${b.max + 1} (logo depois de ${SCORE_BAND_LABELS[b.band]}).`,
      );
    }
  });
  return errors;
}

export function bandOf(score: number, bands: BandRange[]): ScoreBand {
  return bands.find((b) => score >= b.min && score <= b.max)?.band ?? 'COLD';
}

/**
 * Calcula o score (0–100), a faixa e a explicação por critério.
 *
 * - **CLAMP:** soma dos pontos dos critérios atendidos, limitada a 0–100.
 * - **SCALE:** a soma é reescalada entre o mínimo (só negativos) e o máximo
 *   (só positivos) possíveis, para modelos cuja soma passa de 100.
 *
 * Regras inativas ficam de fora; critério que o código não conhece mais é
 * ignorado (não quebra o cálculo).
 */
export function computeScore(model: ScoringModelInput, facts: ScoreFacts, now: Date): ScoreResult {
  const breakdown: BreakdownItem[] = [];
  let raw = 0;
  let maxPossible = 0;
  let minPossible = 0;
  for (const rule of model.rules) {
    if (!rule.active) continue;
    const criterion = criterionOf(rule.criterionKey);
    if (!criterion) continue;
    const params = criterion.params.safeParse(rule.params ?? {});
    if (!params.success) continue;
    const evaluation = criterion.evaluate(facts, params.data, now);
    const points = evaluation.matched ? rule.points : 0;
    raw += points;
    if (rule.points > 0) maxPossible += rule.points;
    else minPossible += rule.points;
    breakdown.push({
      ruleId: rule.id ?? null,
      criterion: rule.criterionKey,
      label: criterion.describe(params.data),
      matched: evaluation.matched,
      points,
      weight: rule.points,
      detail: evaluation.detail,
    });
  }
  const score =
    model.normalization === 'SCALE'
      ? maxPossible === minPossible
        ? 0
        : Math.round((100 * (raw - minPossible)) / (maxPossible - minPossible))
      : Math.min(100, Math.max(0, raw));
  return { score, band: bandOf(score, model.bands), raw, breakdown };
}
