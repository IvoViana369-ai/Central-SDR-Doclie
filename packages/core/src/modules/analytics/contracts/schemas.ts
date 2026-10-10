import { z } from 'zod';
import { CONVERSION_DIMENSIONS } from '../domain/dimensions';

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

// --- Fase 11: relatórios sobre os rollups ------------------------------------

/** Conversão por recorte (coorte do 1º contato no período). */
export const conversionReportInput = analyticsFilterInput.extend({
  dimension: z.enum(CONVERSION_DIMENSIONS),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Use o formato AAAA-MM.')
  .nullish();

/** Evolução mensal (padrão: últimos 12 meses) da equipe ou de uma pessoa. */
export const monthlyReportInput = z.object({
  fromMonth: isoMonth,
  toMonth: isoMonth,
  userId: z.uuid().nullish(),
});

/** Só o período: relatórios da equipe inteira (por SDR, por canal). */
export const teamPeriodInput = z.object({ from: isoDay, to: isoDay });

/** Por canal: só da equipe (os volumes por canal não são separados por pessoa). */
export const channelReportInput = teamPeriodInput;

export const PERFORMANCE_REPORTS = ['conversion', 'sdrPerformance', 'monthly', 'channels'] as const;
export type PerformanceReport = (typeof PERFORMANCE_REPORTS)[number];

export const PERFORMANCE_REPORT_LABELS: Record<PerformanceReport, string> = {
  conversion: 'Conversão por recorte',
  sdrPerformance: 'Desempenho por SDR',
  monthly: 'Evolução mensal',
  channels: 'Canais (WhatsApp × Instagram)',
};

export const exportPerformanceInput = z.discriminatedUnion('report', [
  conversionReportInput.extend({ report: z.literal('conversion') }),
  teamPeriodInput.extend({ report: z.literal('sdrPerformance') }),
  monthlyReportInput.extend({ report: z.literal('monthly') }),
  channelReportInput.extend({ report: z.literal('channels') }),
]);

/** Recalcular os rollups de um período (ex.: depois de importar histórico). */
export const rollupRequestInput = teamPeriodInput;

// --- Insights da carteira (F11-04) -------------------------------------------

/** Gestão: os da equipe (padrão) ou os de uma pessoa; os demais, os próprios. */
export const insightsInput = z.object({ userId: z.uuid().nullish() });

/** Gerar agora: a equipe ou a carteira de uma pessoa (ADMIN e GESTOR). */
export const refreshInsightsInput = z.object({
  scope: z.enum(['TEAM', 'USER']),
  userId: z.uuid().nullish(),
});

export const insightFeedbackInput = z.object({
  insightId: z.uuid(),
  feedback: z.enum(['USEFUL', 'NOT_USEFUL']),
});
