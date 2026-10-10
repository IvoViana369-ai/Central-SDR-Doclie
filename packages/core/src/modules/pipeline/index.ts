// Módulo pipeline (docs/ARCHITECTURE.md §6): etapas configuráveis, movimentação
// com regras, histórico com duração e motivos de perda (Fase 4).
export * from './domain/transitions';
export * from './contracts/schemas';
export {
  applyStageChange,
  moveLeadToStageKey,
  stageRefSelect,
  type StageChange,
} from './infra/stage-change';
export {
  getPipeline,
  listLossReasons,
  requirePipeline,
  updatePipelineStages,
} from './application/stages';
export { moveLeadStage } from './application/move';
export { getPipelineBoard, listStageCards } from './application/board';
export { listLeadStageHistory } from './application/history';
