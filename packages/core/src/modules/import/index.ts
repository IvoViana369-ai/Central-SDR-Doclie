// Módulo import (docs/ARCHITECTURE.md §6): upload, mapeamento, prévia,
// confirmação e relatório de planilhas (docs/MVP.md M04).
export * from './contracts/schemas';
export * from './domain/fields';
export * from './domain/decisions';
export { normalizeImportRow, type NormalizedImportRow, type RowIssue } from './domain/row';
export {
  cancelImportBatch,
  createImportBatch,
  getImportBatch,
  IMPORT_RETENTION_DAYS,
  listImportBatches,
  runImportParse,
  runImportPurge,
} from './application/batches';
export {
  configureImport,
  getImportPreview,
  runImportPreview,
  setDecisionsByStatus,
  setRowDecision,
} from './application/preview';
export { commitImport, getImportReport, runImportCommit } from './application/commit';
