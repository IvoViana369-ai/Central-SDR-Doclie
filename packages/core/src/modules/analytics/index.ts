// Módulo analytics (docs/ARCHITECTURE.md §6): indicadores, funil, quebras por
// cidade, origem e SDR, evolução diária e exportação (Fase 6, básico). Só lê:
// nenhum outro módulo depende deste.
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
