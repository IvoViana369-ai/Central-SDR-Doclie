// Módulo compliance (docs/ARCHITECTURE.md §6; docs/LGPD.md): base legal, opt-in,
// Lista Não Contatar, gate de contactabilidade, titulares.
export * from './contracts/schemas';
export {
  CONTACT_STATUS_LABELS,
  LEGAL_BASIS_LABELS,
  computeContactStatus,
  type ContactStatusInput,
  type MatchedSuppression,
} from './domain/contact-status';
export {
  evaluateContactTiming,
  type ContactTimingInput,
  type ContactTimingResult,
} from './domain/contact-timing';
export {
  GATE_CHANNELS,
  GATE_CHANNEL_LABELS,
  evaluateAllChannels,
  evaluateChannel,
  isWhatsappCandidate,
  type ContactMode,
  type GateChannel,
  type GateInput,
  type GateReasonCode,
  type GateResult,
} from './domain/contactability';
export {
  findActiveSuppressions,
  identifierKey,
  type ActiveSuppression,
  type SuppressionIdentifier,
} from './infra/suppressions';
export {
  leadIdentifiers,
  loadLeadSuppressions,
  refreshLeadContactState,
  refreshLeadsForIdentifiers,
  type LeadSuppressionState,
} from './infra/contact-state';
export { evaluateLeadGate, loadContactTiming, loadGateInput } from './infra/gate';
export {
  addSuppression,
  listSuppressions,
  revokeSuppression,
  suppressIdentifiers,
  type SuppressionToCreate,
} from './application/suppressions';
export {
  DSR_RESPONSE_DAYS,
  createDataSubjectRequest,
  createLegalBasisAssessment,
  listDataSubjectRequests,
  listLegalBasisAssessments,
  updateDataSubjectRequest,
} from './application/requests';
