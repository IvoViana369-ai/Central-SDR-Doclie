import { MIN_SAMPLE, ratio } from './metrics';

/**
 * Intervalo de confiança das taxas (F11-03; docs/SDR-FLOW.md §11): intervalo
 * de Wilson a 95%, que se comporta bem com amostras pequenas e taxas perto de
 * 0% ou 100% (o intervalo "normal" sairia do 0–100%). Abaixo de MIN_SAMPLE na
 * base, a taxa vem com o aviso de amostra insuficiente e não entra em
 * comparação.
 */

const Z_95 = 1.959964;

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export interface Interval {
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: round4(Math.max(0, center - margin)), high: round4(Math.min(1, center + margin)) };
}

export type Comparison = 'ABOVE' | 'BELOW' | 'SIMILAR' | 'INSUFFICIENT';

export const COMPARISON_LABELS: Record<Comparison, string> = {
  ABOVE: 'Acima da média',
  BELOW: 'Abaixo da média',
  SIMILAR: 'Dentro da média',
  INSUFFICIENT: 'Amostra insuficiente',
};

export interface RateStat {
  successes: number;
  trials: number;
  rate: number | null;
  interval: Interval | null;
  /** Base abaixo do mínimo: a taxa é mostrada, mas não comparada. */
  smallSample: boolean;
  /** Em relação à taxa de referência (o total), quando houver. */
  comparison: Comparison | null;
}

/**
 * Taxa com o intervalo e a comparação com a referência: só é "acima" ou
 * "abaixo" quando o intervalo inteiro fica de um lado da referência.
 */
export function rateStat(
  successes: number,
  trials: number,
  reference: number | null = null,
): RateStat {
  const interval = wilsonInterval(successes, trials);
  const smallSample = trials < MIN_SAMPLE;
  let comparison: Comparison | null = null;
  if (reference !== null && trials > 0) {
    if (smallSample) comparison = 'INSUFFICIENT';
    else if (interval && interval.low > reference) comparison = 'ABOVE';
    else if (interval && interval.high < reference) comparison = 'BELOW';
    else comparison = 'SIMILAR';
  }
  return { successes, trials, rate: ratio(successes, trials), interval, smallSample, comparison };
}
