import { describe, expect, it } from 'vitest';
import { auditData, checkAccess } from '../../../shared/use-case';
import type { Actor } from '../../../shared/actor';
import { API_SCOPES, API_SCOPE_KEYS, isApiScope, scopesGrant } from './api-scopes';
import { ROLE_PERMISSIONS } from './permissions';

const key = (scopes: string[]): Actor => ({
  kind: 'apiKey',
  id: '0190f0aa-0000-7000-8000-000000000001',
  name: 'CRM fictício',
  scopes: scopes.filter(isApiScope),
  system: 'DOCLINE_CRM',
});

describe('escopos das chaves de API', () => {
  it('nenhum escopo dá acesso a usuários, configurações, auditoria ou integrações', () => {
    const granted = API_SCOPE_KEYS.flatMap((s) => [...API_SCOPES[s].permissions]);
    for (const forbidden of [
      'user.read',
      'user.manage',
      'settings.manage',
      'audit.read',
      'integration.manage',
      'suppression.read',
      'suppression.revoke',
      'lead.export',
      'lead.anonymize',
      'dsr.manage',
    ]) {
      expect(granted).not.toContain(forbidden);
    }
  });

  it('todo escopo libera só permissões que o ADMIN tem', () => {
    for (const scope of API_SCOPE_KEYS) {
      for (const permission of API_SCOPES[scope].permissions) {
        expect(ROLE_PERMISSIONS.ADMIN.has(permission)).toBe(true);
      }
    }
  });

  it('libera só o que o escopo diz', () => {
    expect(scopesGrant(['leads:read'], 'lead.read')).toBe(true);
    expect(scopesGrant(['leads:read'], 'lead.update')).toBe(false);
    expect(scopesGrant(['suppression:write'], 'optout.register')).toBe(true);
    expect(scopesGrant(['suppression:check'], 'optout.register')).toBe(false);
    expect(scopesGrant(['escopo:inventado'], 'lead.read')).toBe(false);
  });

  it('checkAccess: chave passa no escopo, nunca em "authenticated"; público sempre', () => {
    expect(() => checkAccess(key(['leads:read']), 'lead.read')).not.toThrow();
    expect(() => checkAccess(key(['leads:read']), 'lead.update')).toThrow(/escopo/);
    expect(() => checkAccess(key(['leads:read']), 'authenticated')).toThrow(/escopo/);
    expect(() => checkAccess(key([]), 'public')).not.toThrow();
  });

  it('auditoria: autor INTEGRATION com o id e o nome da chave', () => {
    const data = auditData(
      key(['leads:read']),
      { requestId: 'r-1' },
      {
        action: 'reference.upsert',
        entityType: 'lead',
      },
    );
    expect(data.actorType).toBe('INTEGRATION');
    expect(data.actorId).toBe('0190f0aa-0000-7000-8000-000000000001');
    expect(data.metadata).toEqual({ apiKey: 'CRM fictício' });
  });
});
