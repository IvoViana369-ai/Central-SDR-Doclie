/**
 * Definição única de cada indicador (docs/SDR-FLOW.md §11). Cada um diz se é
 * de **período** (eventos no intervalo), **coorte** (leads do primeiro
 * contato no intervalo, acompanhados até hoje) ou **retrato** (agora).
 */

export type MetricKind = 'period' | 'cohort' | 'snapshot';

export const METRIC_KIND_LABELS: Record<MetricKind, string> = {
  period: 'no período',
  cohort: 'coorte do 1º contato no período',
  snapshot: 'agora',
};

export const METRICS = {
  totalLeads: {
    label: 'Total de leads',
    kind: 'snapshot',
    help: 'Leads ativos (sem mesclados, arquivados e anonimizados).',
  },
  newLeads: { label: 'Novos leads', kind: 'period', help: 'Leads cadastrados no período.' },
  contacted: {
    label: 'Contatados',
    kind: 'period',
    help: 'Leads distintos com mensagem enviada ou contato registrado no período.',
  },
  firstContacts: {
    label: 'Primeiros contatos',
    kind: 'cohort',
    help: 'Leads com o primeiro contato no período: a base das taxas.',
  },
  responded: {
    label: 'Responderam',
    kind: 'cohort',
    help: 'Dos primeiros contatos do período, os que responderam depois do contato (até hoje).',
  },
  responseRate: {
    label: 'Taxa de resposta',
    kind: 'cohort',
    help: 'Responderam ÷ primeiros contatos do período.',
  },
  interested: {
    label: 'Interessados',
    kind: 'period',
    help: 'Leads com resposta classificada como interesse recebida no período.',
  },
  opportunities: {
    label: 'Oportunidades',
    kind: 'period',
    help: 'Transferências ao Comercial no período.',
  },
  conversions: {
    label: 'Conversões',
    kind: 'period',
    help: 'Oportunidades ganhas no período (parceiros e clientes).',
  },
  conversionRate: {
    label: 'Taxa de conversão',
    kind: 'cohort',
    help: 'Dos primeiros contatos do período, os que já viraram oportunidade ganha.',
  },
  optOuts: {
    label: 'Opt-outs',
    kind: 'period',
    help: 'Leads que pediram para não ser contatados no período.',
  },
  medianHoursToFirstContact: {
    label: 'Tempo até o 1º contato',
    kind: 'cohort',
    help: 'Mediana entre o cadastro e o primeiro contato, nos primeiros contatos do período.',
  },
} as const satisfies Record<string, { label: string; kind: MetricKind; help: string }>;

export type MetricKey = keyof typeof METRICS;

/** Abaixo disto, uma taxa vem marcada como "amostra pequena" (§11). */
export const MIN_SAMPLE = 20;

/** Proporção com 4 casas, ou null sem base. */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

export const isSmallSample = (whole: number) => whole > 0 && whole < MIN_SAMPLE;
