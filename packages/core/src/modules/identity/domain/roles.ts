export const ROLES = ['ADMIN', 'MANAGER', 'SDR', 'SALES'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gestor',
  SDR: 'SDR',
  SALES: 'Comercial',
};

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  INVITED: 'Convidado',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

/**
 * Perfis para os quais a verificação em duas etapas é exigida
 * (docs/SECURITY.md §3: SHOULD no MVP, MUST antes das Fases 7–9).
 */
export const TWO_FACTOR_ROLES: readonly Role[] = ['ADMIN', 'MANAGER'];

/**
 * Como a exigência é aplicada (TWO_FACTOR_ENFORCEMENT): `required` bloqueia o
 * acesso até ativar; `reminder` só lembra (aceito apenas em desenvolvimento e
 * testes; a configuração recusa em staging e produção).
 */
export const TWO_FACTOR_ENFORCEMENTS = ['required', 'reminder'] as const;
export type TwoFactorEnforcement = (typeof TWO_FACTOR_ENFORCEMENTS)[number];

/**
 * Situação da verificação em duas etapas de quem está logado:
 * - `ok`: ativada, ou não exigida para o perfil;
 * - `pending`: exigida e desativada, só com lembrete;
 * - `blocked`: exigida e desativada; o acesso fica restrito a "Minha conta".
 */
export type TwoFactorGate = 'ok' | 'pending' | 'blocked';

export function twoFactorGate(
  role: Role,
  enabled: boolean,
  enforcement: TwoFactorEnforcement,
): TwoFactorGate {
  if (enabled || !TWO_FACTOR_ROLES.includes(role)) return 'ok';
  return enforcement === 'required' ? 'blocked' : 'pending';
}
