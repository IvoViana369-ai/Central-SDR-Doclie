// Núcleo de domínio da Docline SDR (docs/ARCHITECTURE.md §5–7).
export * from './shared/errors';
export * from './shared/clock';
export * from './shared/logger';
export * from './shared/actor';
export { maskEmail } from './shared/mask';
export { escapeHtml } from './shared/html';
export { generateToken, hashToken } from './shared/tokens';
export {
  createIdentifierHasher,
  type IdentifierHasher,
  type IdentifierType,
} from './shared/identifier-hash';
export {
  assertAccess,
  requirePermission,
  checkAccess,
  defineUseCase,
  type Access,
  type AuditEntry,
  type CoreDeps,
  type RequestMeta,
  type UseCase,
  type UseCaseContext,
} from './shared/use-case';
export type * from './ports';
export { SpreadsheetError } from './ports/spreadsheet';
export * from './modules/identity';
export * from './modules/audit';
export * from './modules/normalization';
export * from './modules/compliance';
export * from './modules/leads';
export * from './modules/import';
export * from './modules/dedup';
export * from './modules/pipeline';
export * from './modules/scoring';
export * from './modules/settings';
export * from './modules/engagement';
export * from './modules/tasks';
export * from './modules/messaging';
export * from './jobs/catalog';
