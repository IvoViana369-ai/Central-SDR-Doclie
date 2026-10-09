import { z } from 'zod';

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .nullish();

/** Período (datas locais inclusivas; padrão: últimos 30 dias) e pessoa. */
export const analyticsFilterInput = z.object({
  from: isoDay,
  to: isoDay,
  /** Só para quem vê a equipe: os números de uma pessoa. */
  userId: z.uuid().nullish(),
});

export const BREAKDOWN_DIMENSIONS = ['city', 'source', 'sdr'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const breakdownInput = analyticsFilterInput.extend({
  dimension: z.enum(BREAKDOWN_DIMENSIONS),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const REPORT_KINDS = ['overview', 'funnel', 'city', 'source', 'sdr', 'daily'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  overview: 'Indicadores do período',
  funnel: 'Funil por etapa',
  city: 'Por cidade',
  source: 'Por origem',
  sdr: 'Por SDR',
  daily: 'Evolução diária',
};

export const exportReportInput = analyticsFilterInput.extend({ report: z.enum(REPORT_KINDS) });
