// Módulo scoring (docs/ARCHITECTURE.md §6): critérios no código, modelos
// versionados no banco, recálculo e cidades prioritárias (Fase 4). Não depende
// do módulo de leads: quem altera um lead chama o recálculo.
export * from './domain/criteria';
export * from './domain/score';
export * from './contracts/schemas';
export {
  loadActiveModel,
  loadScoreFacts,
  recomputeLeadScores,
  toModelInput,
  type LoadedModel,
  type RecomputeSummary,
} from './infra/recompute';
export {
  activateScoringModel,
  createScoringDraft,
  discardScoringDraft,
  getActiveScoringModel,
  listScoringModels,
  SCORING_CRITERIA,
  simulateScoringModel,
  updateScoringDraft,
} from './application/models';
export {
  addPriorityCity,
  listPriorityCities,
  removePriorityCity,
} from './application/priority-cities';
export { hasUnscoredLeads, runScoreRecomputeAll, runScoreRecomputeLeads } from './application/jobs';
