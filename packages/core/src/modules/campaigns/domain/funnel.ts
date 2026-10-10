/**
 * Funil da campanha (F10-04) e comparação das variantes (F10-05). Cada passo
 * tem uma base declarada: a taxa de "responderam" é sobre os contatados, a de
 * "convertidos" é sobre as oportunidades, e assim por diante.
 *
 * Atribuição: um marco conta para a campanha quando acontece entre a
 * liberação do lead para a fila e o fim da janela de atribuição (ou a
 * liberação do mesmo lead numa campanha seguinte, o que vier antes).
 */

export const FUNNEL_STEPS = [
  'selected',
  'eligible',
  'released',
  'contacted',
  'delivered',
  'replied',
  'interested',
  'opportunity',
  'converted',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  selected: 'Selecionados',
  eligible: 'Aptos',
  released: 'Liberados para a fila',
  contacted: 'Contatados',
  delivered: 'Entregues',
  replied: 'Responderam',
  interested: 'Interessados',
  opportunity: 'Oportunidades',
  converted: 'Convertidos',
};

export const FUNNEL_STEP_HELP: Record<FunnelStep, string> = {
  selected: 'Leads do filtro no momento da montagem (retrato congelado).',
  eligible: 'Passaram no gate do canal e nas regras da campanha.',
  released: 'Entraram na cadência, respeitando o limite diário por SDR.',
  contacted: 'Primeiro contato registrado ou enviado depois da liberação.',
  delivered: 'Entrega confirmada pelo canal (só envios pela API têm essa confirmação).',
  replied: 'Responderam depois do primeiro contato.',
  interested: 'Resposta classificada como interesse.',
  opportunity: 'Viraram oportunidade para o Comercial.',
  converted: 'Oportunidade ganha.',
};

/** Base de cada taxa (null: o primeiro passo não tem taxa). */
export const FUNNEL_BASE: Record<FunnelStep, FunnelStep | null> = {
  selected: null,
  eligible: 'selected',
  released: 'eligible',
  contacted: 'released',
  delivered: 'contacted',
  replied: 'contacted',
  interested: 'replied',
  opportunity: 'contacted',
  converted: 'opportunity',
};

export const OPTED_OUT_LABEL = 'Pediram para sair';

/** Janela de atribuição de um marco à campanha, contada da liberação. */
export const ATTRIBUTION_DAYS = 90;

export type FunnelCounts = Record<FunnelStep, number> & { optedOut: number };

export interface FunnelRow {
  step: FunnelStep | 'optedOut';
  label: string;
  count: number;
  base: FunnelStep | null;
  /** Proporção sobre a base, com 4 casas; null sem base ou base zerada. */
  rate: number | null;
}

/** Proporção com 4 casas, ou null sem base (mesma regra dos Indicadores). */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

export function buildFunnel(counts: FunnelCounts): FunnelRow[] {
  const rows: FunnelRow[] = FUNNEL_STEPS.map((step) => {
    const base = FUNNEL_BASE[step];
    return {
      step,
      label: FUNNEL_STEP_LABELS[step],
      count: counts[step],
      base,
      rate: base ? rate(counts[step], counts[base]) : null,
    };
  });
  rows.push({
    step: 'optedOut',
    label: OPTED_OUT_LABEL,
    count: counts.optedOut,
    base: 'contacted',
    rate: rate(counts.optedOut, counts.contacted),
  });
  return rows;
}

// --- Teste A/B -------------------------------------------------------------

/** Mínimo de contatados em cada variante antes de qualquer comparação. */
export const AB_MIN_SAMPLE = 30;
/** Nível de significância total; dividido entre as comparações (Bonferroni). */
export const AB_ALPHA = 0.05;

export type AbVerdict = 'INSUFFICIENT_SAMPLE' | 'NO_DIFFERENCE' | 'LIKELY_DIFFERENCE';

export const AB_VERDICT_LABELS: Record<AbVerdict, string> = {
  INSUFFICIENT_SAMPLE: `Amostra pequena: menos de ${AB_MIN_SAMPLE} contatados em uma das variantes`,
  NO_DIFFERENCE: 'Sem diferença clara até aqui',
  LIKELY_DIFFERENCE: 'Diferença provável; a decisão é do gestor',
};

export interface VariantSample {
  id: string;
  label: string;
  /** Quem chegou ao marco (ex.: responderam). */
  successes: number;
  /** A base (ex.: contatados). */
  trials: number;
}

export interface AbComparison {
  variantId: string;
  label: string;
  baselineId: string;
  baselineLabel: string;
  /** Diferença de taxa (variante − referência), com 4 casas. */
  difference: number | null;
  /** p bilateral do teste de duas proporções; null sem amostra suficiente. */
  pValue: number | null;
  verdict: AbVerdict;
}

/** Função de distribuição da normal padrão (Abramowitz e Stegun 7.1.26). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Teste z de duas proporções (bilateral). Null quando não há variação. */
export function twoProportionTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { z: number; pValue: number } | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (x1 / n1 - x2 / n2) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z: Math.round(z * 10_000) / 10_000, pValue: Math.round(pValue * 10_000) / 10_000 };
}

/**
 * Compara cada variante com a primeira (A). Nunca declara vencedora: abaixo
 * da amostra mínima não há veredito, e uma diferença provável fica para o
 * gestor decidir (outras causas podem pesar: época, cidade, SDR).
 */
export function compareVariants(samples: readonly VariantSample[]): AbComparison[] {
  const ordered = [...samples].sort((a, b) => a.label.localeCompare(b.label));
  const [baseline, ...others] = ordered;
  if (!baseline || others.length === 0) return [];
  const alpha = AB_ALPHA / others.length;
  return others.map((variant) => {
    const head = {
      variantId: variant.id,
      label: variant.label,
      baselineId: baseline.id,
      baselineLabel: baseline.label,
    };
    const r1 = rate(variant.successes, variant.trials);
    const r0 = rate(baseline.successes, baseline.trials);
    const difference = r1 === null || r0 === null ? null : Math.round((r1 - r0) * 10_000) / 10_000;
    if (variant.trials < AB_MIN_SAMPLE || baseline.trials < AB_MIN_SAMPLE) {
      return { ...head, difference, pValue: null, verdict: 'INSUFFICIENT_SAMPLE' as const };
    }
    const test = twoProportionTest(
      variant.successes,
      variant.trials,
      baseline.successes,
      baseline.trials,
    );
    const pValue = test ? test.pValue : 1;
    return {
      ...head,
      difference,
      pValue,
      verdict: pValue < alpha ? ('LIKELY_DIFFERENCE' as const) : ('NO_DIFFERENCE' as const),
    };
  });
}
