import { describe, expect, it } from 'vitest';
import { auditActionLabel, describeAuditEntry } from './labels';

describe('rótulos da auditoria', () => {
  it('traduz ações conhecidas e mantém as desconhecidas', () => {
    expect(auditActionLabel('access.denied')).toBe('Acesso negado');
    expect(auditActionLabel('lead.created')).toBe('lead.created');
  });

  it('descreve alterações e metadados em português', () => {
    expect(describeAuditEntry({ status: ['ACTIVE', 'INACTIVE'] }, { revokedSessions: 2 })).toBe(
      'Status: Ativo → Inativo · Sessões encerradas: 2',
    );
    expect(describeAuditEntry({ role: [null, 'SDR'] }, null)).toBe('Perfil: — → SDR');
    expect(describeAuditEntry(null, { required: 'user.manage' })).toBe(
      'Permissão exigida: Gerenciar usuários',
    );
    expect(
      describeAuditEntry(null, { email: 'a***@x.com', reason: 'INVALID_EMAIL_OR_PASSWORD' }),
    ).toBe('E-mail: a***@x.com · Motivo: e-mail ou senha incorretos');
  });

  it('descreve as ações do pipeline e do score (Fase 4)', () => {
    expect(auditActionLabel('lead.stage_change')).toBe('Etapa do pipeline alterada');
    expect(
      describeAuditEntry({ stage: ['Novo', 'Descartado'] }, { lossReason: 'OUT_OF_PROFILE' }),
    ).toBe('Etapa: Novo → Descartado · Motivo da perda: OUT_OF_PROFILE');
    expect(describeAuditEntry({ 'NEW.name': ['Novo', 'Entrada'] }, null)).toBe(
      'NEW · Nome: Novo → Entrada',
    );
  });
});
