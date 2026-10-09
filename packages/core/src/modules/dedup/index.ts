// Módulo dedup (docs/ARCHITECTURE.md §6): detecção, revisão e mesclagem de
// leads possivelmente duplicados. Nada é excluído automaticamente (M06).
export * from './domain/scoring';
export * from './domain/merge';
export * from './contracts/schemas';
export { upsertCandidate, uniqueSignals, type CandidateUpsert } from './infra/candidates';
export {
  detectDuplicates,
  findDuplicatePairs,
  NAME_SIMILARITY_MIN,
  SHARED_VALUE_LIMIT,
  type DetectionSummary,
  type DetectionTarget,
  type PairSignals,
} from './infra/detection';
export {
  DUPLICATE_STATUS_LABELS,
  getDuplicate,
  ignoreDuplicate,
  keepDuplicatesSeparate,
  listDuplicates,
} from './application/review';
export { mergeDuplicate } from './application/merge';
export { requestDuplicateScan, runDuplicateCheck, runDuplicateScan } from './application/scan';
