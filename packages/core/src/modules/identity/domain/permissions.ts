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
  /** Relatórios da equipe, exportação de relatórios e custos da IA. */
  'report.read',
  // Leads
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.import',
  /** Prospecção na base aberta do CNPJ: buscar, aprovar e recusar (Fase 9). */
  'prospecting.run',
  'lead.assign',
  'lead.bulk',
  /** Campanhas: criar, montar, ativar, pausar e ver o funil e o A/B (Fase 10). */
  'campaign.manage',
  'lead.export',
  'lead.anonymize',
  'tag.manage',
  'duplicate.decide',
  // Contato e conformidade
  'ai.generate',
  'optout.register',
  'suppression.read',
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
    'report.read',
    'lead.import',
    'prospecting.run',
    'lead.assign',
    'lead.bulk',
    'campaign.manage',
    'lead.export',
    'tag.manage',
    'duplicate.decide',
    'suppression.read',
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
