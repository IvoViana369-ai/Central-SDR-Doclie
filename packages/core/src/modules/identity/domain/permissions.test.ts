import { describe, expect, it } from 'vitest';
import { PERMISSIONS, permissionsOf, roleHasPermission, type Permission } from './permissions';
import { ROLES, type Role } from './roles';

/**
 * Matriz esperada, transcrita de docs/SECURITY.md §4.2 (itens ⚙️ no padrão
 * conservador). Se este teste falhar, atualize o documento ou a matriz — os dois
 * precisam concordar.
 */
const EXPECTED: Record<Permission, Role[]> = {
  'user.read': ['ADMIN', 'MANAGER'],
  'user.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'integration.manage': ['ADMIN'],
  'report.read': ['ADMIN', 'MANAGER'],
  'lead.read': ['ADMIN', 'MANAGER', 'SDR', 'SALES'],
  'lead.create': ['ADMIN', 'MANAGER', 'SDR', 'SALES'],
  'lead.update': ['ADMIN', 'MANAGER', 'SDR', 'SALES'],
  'lead.import': ['ADMIN', 'MANAGER'],
  'lead.assign': ['ADMIN', 'MANAGER'],
  'lead.bulk': ['ADMIN', 'MANAGER'],
  'lead.export': ['ADMIN', 'MANAGER'],
  'lead.anonymize': ['ADMIN'],
  'tag.manage': ['ADMIN', 'MANAGER'],
  'duplicate.decide': ['ADMIN', 'MANAGER'],
  'ai.generate': ['ADMIN', 'MANAGER', 'SDR', 'SALES'],
  'optout.register': ['ADMIN', 'MANAGER', 'SDR', 'SALES'],
  'suppression.read': ['ADMIN', 'MANAGER'],
  'suppression.revoke': ['ADMIN'],
  'permission.update': ['ADMIN', 'MANAGER'],
  'dsr.manage': ['ADMIN'],
};

describe('matriz de permissões', () => {
  it('cobre todas as permissões declaradas', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    for (const role of ROLES) {
      const allowed = EXPECTED[permission].includes(role);
      it(`${role} ${allowed ? 'pode' : 'não pode'} ${permission}`, () => {
        expect(roleHasPermission(role, permission)).toBe(allowed);
      });
    }
  }

  it('ADMIN tem todas as permissões', () => {
    expect(permissionsOf('ADMIN')).toEqual([...PERMISSIONS]);
  });
});
