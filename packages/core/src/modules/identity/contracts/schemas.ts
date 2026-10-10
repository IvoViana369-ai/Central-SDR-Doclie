import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../domain/password-policy';
import { ROLES } from '../domain/roles';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'E-mail inválido.' }));

const name = z.string().trim().min(2, 'Informe o nome completo.').max(120, 'Nome muito longo.');

const id = z.uuid({ message: 'Identificador inválido.' });

export const inviteUserInput = z.object({
  name,
  email,
  role: z.enum(ROLES),
  teamId: id.nullish(),
});

export const userIdInput = z.object({ userId: id });

export const acceptInvitationInput = z.object({
  token: z.string().min(20).max(200),
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

export const changeUserRoleInput = z.object({ userId: id, role: z.enum(ROLES) });

export const setUserStatusInput = z.object({
  userId: id,
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const listUsersInput = z.object({
  status: z.enum(['INVITED', 'ACTIVE', 'INACTIVE']).optional(),
  role: z.enum(ROLES).optional(),
  q: z.string().trim().max(120).optional(),
});

export type InviteUserInput = z.input<typeof inviteUserInput>;
export type ListUsersInput = z.input<typeof listUsersInput>;
