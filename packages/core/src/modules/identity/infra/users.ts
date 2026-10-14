import type { DbTransaction } from '@docline/db';
import { NotFoundError } from '../../../shared/errors';

/** Campos de usuário expostos fora do módulo (nunca credenciais). */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  teamId: true,
  timezone: true,
  lastLoginAt: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

export async function getUserOrThrow(tx: DbTransaction, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) throw new NotFoundError('Usuário não encontrado.');
  return user;
}

export async function countActiveAdmins(tx: DbTransaction): Promise<number> {
  return tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
}

/**
 * Serializa operações que alteram administradores, evitando que duas
 * requisições simultâneas removam juntas os dois últimos ADMINs.
 */
export async function lockAdminChanges(tx: DbTransaction): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('docline.admin_changes'))`);
}
