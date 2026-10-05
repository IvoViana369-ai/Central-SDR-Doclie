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
  'access.denied': 'Acesso negado',
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
  'duplicate.decide': 'Decidir duplicados',
  'ai.generate': 'Gerar mensagens com IA',
  'optout.register': 'Registrar opt-out',
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
