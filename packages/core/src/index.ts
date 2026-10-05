// Núcleo de domínio da Docline SDR (docs/ARCHITECTURE.md §5–7).
export * from './shared/errors';
export * from './shared/clock';
export * from './shared/logger';
export * from './shared/actor';
export { maskEmail } from './shared/mask';
export { escapeHtml } from './shared/html';
export { generateToken, hashToken } from './shared/tokens';
export {
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
export * from './modules/identity';
export * from './modules/audit';
export * from './jobs/catalog';
