/**
 * Eventos da timeline do lead (docs/DATABASE.md §4.4). Os payloads guardam ids,
 * tipos e valores mascarados, nunca dados pessoais em claro: a timeline é
 * append-only e não pode depender de anonimização posterior.
 */
export const LEAD_EVENTS = {
  created: 'lead.created',
  updated: 'lead.updated',
  archived: 'lead.archived',
  unarchived: 'lead.unarchived',
  ownerAssigned: 'owner.assigned',
  personAdded: 'person.added',
  personUpdated: 'person.updated',
  personRemoved: 'person.removed',
  contactPointAdded: 'contact_point.added',
  contactPointUpdated: 'contact_point.updated',
  contactPointRemoved: 'contact_point.removed',
  noteAdded: 'note.added',
  noteRemoved: 'note.removed',
  tagAdded: 'tag.added',
  tagRemoved: 'tag.removed',
  permissionChanged: 'permission.changed',
  optOutRegistered: 'optout.registered',
  suppressionRevoked: 'suppression.revoked',
  anonymized: 'lead.anonymized',
} as const;

export type LeadEventType = (typeof LEAD_EVENTS)[keyof typeof LEAD_EVENTS];

export const LEAD_EVENT_LABELS: Record<LeadEventType, string> = {
  'lead.created': 'Lead cadastrado',
  'lead.updated': 'Dados alterados',
  'lead.archived': 'Lead arquivado',
  'lead.unarchived': 'Lead reativado',
  'owner.assigned': 'Responsável alterado',
  'person.added': 'Pessoa adicionada',
  'person.updated': 'Pessoa alterada',
  'person.removed': 'Pessoa removida',
  'contact_point.added': 'Contato adicionado',
  'contact_point.updated': 'Contato alterado',
  'contact_point.removed': 'Contato removido',
  'note.added': 'Observação adicionada',
  'note.removed': 'Observação removida',
  'tag.added': 'Tag adicionada',
  'tag.removed': 'Tag removida',
  'permission.changed': 'Base legal ou opt-in alterado',
  'optout.registered': 'Opt-out registrado',
  'suppression.revoked': 'Item da Lista Não Contatar revogado',
  'lead.anonymized': 'Lead anonimizado',
};
