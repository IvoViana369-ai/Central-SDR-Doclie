// Módulo leads (docs/ARCHITECTURE.md §6): lead, pessoas, contatos, origem, tags,
// observações, responsável, timeline e histórico. Escopo por perfil em toda consulta.
export * from './contracts/schemas';
export * from './domain/lead';
export { LEAD_EVENTS, LEAD_EVENT_LABELS, type LeadEventType } from './domain/events';
export { leadScopeWhere } from './infra/scope';
export {
  checkDuplicates,
  PossibleDuplicateError,
  type DuplicateMatch,
  type DuplicateReason,
  type DuplicateReasonKind,
} from './application/duplicates';
export { createLead } from './application/create-lead';
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
  getLeadContactability,
  registerOptOut,
  setChannelPermission,
} from './application/compliance';
export * from './contracts/filters';
export { countLeads, searchLeads } from './application/search';
export { BULK_LIMIT, bulkLeads } from './application/bulk';
export { deleteView, listSavedViews, saveView, updateView } from './application/saved-views';
