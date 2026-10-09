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
  'auth.2fa_enabled': 'Verificação em duas etapas ativada',
  'auth.2fa_disabled': 'Verificação em duas etapas desativada',
  'auth.2fa_challenge': 'Senha correta, aguardando código',
  'auth.2fa_backup_codes': 'Novos códigos de recuperação',
  'user.2fa_reset': 'Verificação em duas etapas redefinida',
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
  'import.upload': 'Planilha enviada',
  'import.configure': 'Importação configurada',
  'import.commit': 'Importação confirmada',
  'import.completed': 'Importação concluída',
  'import.cancel': 'Importação cancelada',
  'import.purge': 'Linhas de importação apagadas (retenção)',
  'lead.import_link': 'Origem registrada por importação',
  'lead.import_update': 'Lead completado por importação',
  'lead.merge': 'Lead mesclado com outro',
  'lead.merged_into': 'Lead mesclado em outro',
  'duplicate.keep_separate': 'Duplicados mantidos separados',
  'duplicate.ignore': 'Possível duplicado ignorado',
  'duplicate.scan_requested': 'Varredura de duplicados solicitada',
  'duplicate.scan_completed': 'Varredura de duplicados concluída',
  'lead.stage_change': 'Etapa do pipeline alterada',
  'pipeline.stages_update': 'Etapas do pipeline configuradas',
  'scoring.draft_create': 'Rascunho do score criado',
  'scoring.draft_update': 'Rascunho do score alterado',
  'scoring.draft_discard': 'Rascunho do score descartado',
  'scoring.activate': 'Modelo de score ativado',
  'priority_city.add': 'Cidade prioritária incluída',
  'priority_city.remove': 'Cidade prioritária retirada',
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
  fileName: 'Arquivo',
  fileSize: 'Tamanho (bytes)',
  importBatchId: 'Importação',
  rowNumber: 'Linha',
  mergedCode: 'Lead mesclado',
  survivorCode: 'Lead que ficou',
  fields: 'Campos escolhidos',
  leads: 'Leads',
  note: 'Observação',
  created: 'Criados',
  linked: 'Vinculados',
  updated: 'Completados',
  skipped: 'Pulados',
  errors: 'Com erro',
  duplicatesFlagged: 'Duplicados sinalizados',
  pairs: 'Pares',
  stage: 'Etapa',
  from: 'De',
  to: 'Para',
  durationSeconds: 'Tempo na etapa anterior (s)',
  lossReason: 'Motivo da perda',
  override: 'Movimentação de gestor',
  slaHours: 'SLA (horas)',
  position: 'Ordem',
  city: 'Cidade',
  version: 'Versão',
  activeVersion: 'Versão ativa',
  rules: 'Regras',
};

/** Campo com prefixo (ex.: `NEW.name` na configuração de etapas) → "NEW · Nome". */
function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const dot = field.lastIndexOf('.');
  if (dot <= 0) return field;
  const last = field.slice(dot + 1);
  return `${field.slice(0, dot)} · ${FIELD_LABELS[last] ?? last}`;
}

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
        `${fieldLabel(field)}: ${valueLabel(field, value[0])} → ${valueLabel(field, value[1])}`,
      );
    }
  }
  if (metadata && typeof metadata === 'object') {
    for (const [field, value] of Object.entries(metadata as Record<string, unknown>)) {
      parts.push(`${fieldLabel(field)}: ${valueLabel(field, value)}`);
    }
  }
  return parts.join(' · ');
}
