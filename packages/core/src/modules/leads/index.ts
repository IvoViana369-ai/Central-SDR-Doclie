// Módulo leads (docs/ARCHITECTURE.md §6): lead, pessoas, contatos, origem, tags,
// observações, responsável, timeline e histórico. Escopo por perfil em toda consulta.
export * from './contracts/schemas';
export * from './domain/lead';
export { LEAD_EVENTS, LEAD_EVENT_LABELS, type LeadEventType } from './domain/events';
export { leadScopeWhere, requireLeadInScope } from './infra/scope';
export { auditLead, recordLeadEvent, touchLead } from './infra/events';
export { ENTRY_STAGE_KEY } from './infra/stage-entry';
export {
  checkDuplicates,
  GENERIC_DOMAINS,
  PossibleDuplicateError,
  type DuplicateMatch,
  type DuplicateReason,
  type DuplicateReasonKind,
} from './application/duplicates';
export {
  createLead,
  insertLead,
  prepareLeadCreation,
  type PreparedLead,
} from './application/create-lead';
export { updateLead } from './application/update-lead';
export { getLead, type LeadDetail } from './application/get-lead';
export { addPerson, removePerson, updatePerson } from './application/people';
export {
  addContactPoint,
  removeContactPoint,
  updateContactPoint,
} from './application/contact-points';
export { addNote, removeNote, setNotePinned } from './application/notes';
export { addLeadTag, createTag, listTags, removeLeadTag, updateTag } from './application/tags';
export { assignLead, claimLead } from './application/assignment';
export { archiveLead, unarchiveLead } from './application/archive';
export { listLeadHistory, listLeadTimeline } from './application/timeline';
export {
  getUserTerritories,
  listLeadSources,
  listSegments,
  listStates,
  searchMunicipalities,
  setUserTerritories,
} from './application/reference';
export {
  anonymizeLead,
  applyLeadOptOut,
  getLeadContactability,
  registerOptOut,
  requireLeadForOptOut,
  setChannelPermission,
} from './application/compliance';
export * from './contracts/filters';
export { countLeads, countSelection, searchLeads, selectionWhere } from './application/search';
export { BULK_LIMIT, bulkLeads } from './application/bulk';
export { EXPORT_LIMIT, EXPORTS_PER_DAY, exportLeads } from './application/export';
export { deleteView, listSavedViews, saveView, updateView } from './application/saved-views';
