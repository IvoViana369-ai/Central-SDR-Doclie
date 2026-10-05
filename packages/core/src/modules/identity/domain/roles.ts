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
