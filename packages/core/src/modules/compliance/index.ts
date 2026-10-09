// Módulo compliance (docs/ARCHITECTURE.md §6; docs/LGPD.md): base legal, opt-in,
// Lista Não Contatar, gate de contactabilidade, titulares.
export {
  CONTACT_STATUS_LABELS,
  LEGAL_BASIS_LABELS,
  computeContactStatus,
  type ContactStatusInput,
  type MatchedSuppression,
} from './domain/contact-status';
export {
  findActiveSuppressions,
  identifierKey,
  type ActiveSuppression,
  type SuppressionIdentifier,
} from './infra/suppressions';
