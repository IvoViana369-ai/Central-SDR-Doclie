import type { Permission } from '@docline/core/permissions';
import { ROLE_LABELS, USER_STATUS_LABELS } from '@docline/core/roles';

/** Rótulos em português das ações registradas na auditoria. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'user.invited': 'Usuário convidado',
  'user.invitation_resent': 'Convite reenviado',
  'user.invitation_accepted': 'Convite aceito',
  'user.role_changed': 'Perfil alterado',
  'user.status_changed': 'Status alterado',
  'auth.login': 'Login',
  'auth.login_failed': 'Falha de login',
  'auth.login_alert': 'Alerta: muitas falhas de login',
  'access.denied': 'Acesso negado',
  'user.territories_changed': 'Territórios alterados',
  'lead.create': 'Lead cadastrado',
  'lead.update': 'Lead alterado',
  'lead.archive': 'Lead arquivado',
  'lead.unarchive': 'Lead reativado',
  'lead.assign': 'Responsável alterado',
  'lead.person.add': 'Pessoa adicionada',
  'lead.person.update': 'Pessoa alterada',
  'lead.person.remove': 'Pessoa removida',
  'lead.contact_point.add': 'Contato adicionado',
  'lead.contact_point.update': 'Contato alterado',
  'lead.contact_point.remove': 'Contato removido',
  'lead.note.add': 'Observação adicionada',
  'lead.note.pin': 'Observação fixada/desafixada',
  'lead.note.remove': 'Observação removida',
  'lead.tag.add': 'Tag aplicada',
  'lead.tag.remove': 'Tag retirada',
  'lead.optout': 'Opt-out registrado',
  'lead.permission': 'Base legal do canal alterada',
  'lead.anonymize': 'Lead anonimizado',
  'lead.bulk': 'Ação em massa',
  'lead.export': 'Leads exportados',
  'tag.create': 'Tag criada',
  'tag.update': 'Tag alterada',
  'view.create': 'Visão salva',
  'view.update': 'Visão alterada',
  'view.delete': 'Visão excluída',
  'suppression.add': 'Incluído na Lista Não Contatar',
  'suppression.revoke': 'Supressão revogada',
  'dsr.create': 'Solicitação de titular registrada',
  'dsr.update': 'Solicitação de titular atualizada',
  'legal_basis_assessment.create': 'Avaliação de base legal registrada',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

const FIELD_LABELS: Record<string, string> = {
  role: 'Perfil',
  status: 'Status',
  required: 'Permissão exigida',
  revokedSessions: 'Sessões encerradas',
  email: 'E-mail',
  reason: 'Motivo',
  system: 'Processo',
  code: 'Código',
  displayName: 'Nome',
  companyName: 'Razão social',
  tradeName: 'Nome fantasia',
  leadType: 'Tipo',
  segmentId: 'Segmento',
  category: 'Categoria',
  cnpj: 'CNPJ',
  addressLine: 'Endereço',
  addressNumber: 'Número',
  addressComplement: 'Complemento',
  neighborhood: 'Bairro',
  cityRaw: 'Cidade',
  municipalityCode: 'Município (IBGE)',
  stateUf: 'UF',
  postalCode: 'CEP',
  websiteUrl: 'Site',
  description: 'Observações gerais',
  originSource: 'Origem',
  legalBasis: 'Base legal',
  ownerId: 'Responsável',
  strategy: 'Forma',
  person: 'Pessoa',
  roleTitle: 'Cargo',
  isPrimary: 'Principal',
  isDecisionMaker: 'Decisor',
  notes: 'Notas',
  phone: 'Telefone',
  instagram: 'Instagram',
  label: 'Rótulo',
  whatsappStatus: 'WhatsApp',
  personId: 'Pessoa',
  pinned: 'Fixada',
  tag: 'Tag',
  name: 'Nome',
  color: 'Cor',
  active: 'Ativa',
  territories: 'Territórios',
  subjectId: 'Item',
  duplicatesAcknowledged: 'Duplicados confirmados',
  count: 'Quantidade',
  filter: 'Filtro',
  q: 'Busca',
  includeContacts: 'Com contatos',
  omittedContacts: 'Contatos fora (Não Contatar)',
  target: 'Alvo',
  selected: 'Selecionados',
  changed: 'Alterados',
  bulkAction: 'Ação',
  scope: 'Abrangência',
  failures: 'Falhas',
  sources: 'Origens',
};

const PERMISSION_LABELS: Record<Permission, string> = {
  'user.read': 'Ver equipe',
  'user.manage': 'Gerenciar usuários',
  'audit.read': 'Ver auditoria',
  'settings.manage': 'Configurações',
  'integration.manage': 'Integrações',
  'lead.read': 'Ver leads',
  'lead.create': 'Criar leads',
  'lead.update': 'Editar leads',
  'lead.import': 'Importar leads',
  'lead.assign': 'Distribuir leads',
  'lead.bulk': 'Ações em massa',
  'lead.export': 'Exportar leads',
  'lead.anonymize': 'Anonimizar leads',
  'tag.manage': 'Gerenciar tags',
  'duplicate.decide': 'Decidir duplicados',
  'ai.generate': 'Gerar mensagens com IA',
  'optout.register': 'Registrar opt-out',
  'suppression.read': 'Ver Lista Não Contatar',
  'suppression.revoke': 'Revogar Não Contatar',
  'permission.update': 'Alterar base legal',
  'dsr.manage': 'Pedidos de titulares',
};

const REASON_LABELS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'e-mail ou senha incorretos',
  FORBIDDEN: 'usuário sem acesso ativo',
};

function valueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  if (field === 'role') return ROLE_LABELS[text as keyof typeof ROLE_LABELS] ?? text;
  if (field === 'status')
    return USER_STATUS_LABELS[text as keyof typeof USER_STATUS_LABELS] ?? text;
  if (field === 'required') return PERMISSION_LABELS[text as Permission] ?? text;
  if (field === 'reason') return REASON_LABELS[text] ?? text;
  return text;
}

/** Resumo legível de alterações e metadados de um registro de auditoria. */
export function describeAuditEntry(changes: unknown, metadata: unknown): string {
  const parts: string[] = [];
  if (changes && typeof changes === 'object') {
    for (const [field, value] of Object.entries(changes as Record<string, unknown[]>)) {
      parts.push(
        `${FIELD_LABELS[field] ?? field}: ${valueLabel(field, value[0])} → ${valueLabel(field, value[1])}`,
      );
    }
  }
  if (metadata && typeof metadata === 'object') {
    for (const [field, value] of Object.entries(metadata as Record<string, unknown>)) {
      parts.push(`${FIELD_LABELS[field] ?? field}: ${valueLabel(field, value)}`);
    }
  }
  return parts.join(' · ');
}
