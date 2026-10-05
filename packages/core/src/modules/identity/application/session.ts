import type { DbClient } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import { maskEmail } from '../../../shared/mask';
import { auditData, type RequestMeta } from '../../../shared/use-case';

/**
 * Monta o ator a partir do banco a cada requisição: mudanças de perfil ou
 * desativação valem imediatamente, sem depender de dados guardados na sessão.
 */
export async function resolveActor(db: DbClient, userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, teamId: true },
  });
  if (!user) return null;
  return { kind: 'user', id: user.id, role: user.role, status: user.status, teamId: user.teamId };
}

/** Registra tentativa de login na auditoria (e-mail mascarado em falhas). */
export async function recordSignIn(
  db: DbClient,
  meta: RequestMeta,
  attempt: { success: true; userId: string } | { success: false; email: string; reason: string },
): Promise<void> {
  if (attempt.success) {
    await db.$transaction([
      db.user.update({ where: { id: attempt.userId }, data: { lastLoginAt: new Date() } }),
      db.auditLog.create({
        data: auditData({ kind: 'anonymous' }, meta, {
          action: 'auth.login',
          entityType: 'user',
          entityId: attempt.userId,
          actorOverride: { type: 'USER', id: attempt.userId },
        }),
      }),
    ]);
    return;
  }
  await db.auditLog.create({
    data: auditData({ kind: 'anonymous' }, meta, {
      action: 'auth.login_failed',
      entityType: 'user',
      metadata: { email: maskEmail(attempt.email), reason: attempt.reason },
    }),
  });
}
