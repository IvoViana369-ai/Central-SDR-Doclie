// Módulo analytics (docs/ARCHITECTURE.md §6): indicadores, funil, quebras por
// cidade, origem e SDR, evolução diária e exportação (Fase 6, básico); rollups
// diários, conversão por recorte com intervalo de confiança, desempenho por
// SDR, evolução mensal e canais (Fase 11). Só lê (e grava os próprios
// rollups): nenhum outro módulo depende deste.
export * from './domain';
export * from './contracts/schemas';
export {
  exportAnalyticsReport,
  getAnalyticsBreakdown,
  getAnalyticsOverview,
  getDailySeries,
  getDashboard,
  getStageFunnel,
  type BreakdownRow,
  type DashboardData,
} from './application/analytics';
export {
  exportPerformanceReport,
  getChannelReport,
  getConversionReport,
  getMonthlyEvolution,
  getSdrPerformance,
  type ChannelReport,
  type CohortRates,
  type ConversionReport,
  type MonthlyReport,
  type SdrPerformanceReport,
} from './application/performance';
export {
  ANALYTICS_ROLLUP_KEY,
  requestAnalyticsRollup,
  runAnalyticsRollup,
  type RollupStatus,
} from './application/rollup';
export {
  generateInsights,
  getInsights,
  rateInsight,
  runInsightsJob,
  type InsightsView,
} from './application/insights';
