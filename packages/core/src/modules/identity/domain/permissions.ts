import type { Role } from './roles';

/**
 * Permissões do sistema (docs/SECURITY.md §4.2).
 *
 * O escopo de dados (quais leads cada perfil enxerga) é aplicado à parte, nas
 * consultas de cada módulo (§4.1). Itens marcados como configuráveis (⚙️) no
 * documento estão aqui com o padrão conservador; tornar configurável quando
 * houver necessidade real.
 */
export const PERMISSIONS = [
  // Plataforma
  'user.read',
  'user.manage',
  'audit.read',
  'settings.manage',
  'integration.manage',
  // Leads
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.import',
  'lead.assign',
  'lead.bulk',
  'lead.export',
  'lead.anonymize',
  'tag.manage',
  'duplicate.decide',
  // Contato e conformidade
  'ai.generate',
  'optout.register',
  'suppression.revoke',
  'permission.update',
  'dsr.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const LEAD_BASICS: Permission[] = [
  'lead.read',
  'lead.create',
  'lead.update',
  'ai.generate',
  'optout.register',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  MANAGER: new Set<Permission>([
    ...LEAD_BASICS,
    'user.read',
    'lead.import',
    'lead.assign',
    'lead.bulk',
    'lead.export',
    'tag.manage',
    'duplicate.decide',
    'permission.update',
  ]),
  SDR: new Set<Permission>(LEAD_BASICS),
  SALES: new Set<Permission>(LEAD_BASICS),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}
