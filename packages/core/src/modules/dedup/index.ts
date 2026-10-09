// Módulo dedup (docs/ARCHITECTURE.md §6): detecção, revisão e mesclagem de
// leads possivelmente duplicados. Nada é excluído automaticamente (M06).
export * from './domain/scoring';
export { upsertCandidate } from './infra/candidates';
