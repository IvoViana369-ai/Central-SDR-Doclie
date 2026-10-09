import 'server-only';
import { resolveActor, twoFactorGate, type Actor, type TwoFactorGate } from '@docline/core';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth } from './auth';
import { getContainer } from './container';

export interface SessionUser {
  actor: Extract<Actor, { kind: 'user' }>;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  /** `blocked`: ADMIN/GESTOR sem 2FA, com acesso só a "Minha conta" (docs/SECURITY.md §3). */
  twoFactor: TwoFactorGate;
}

/**
 * Sessão validada no servidor + ator montado a partir do banco (perfil e status
 * atuais). Memorizado por requisição.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const actor = await resolveActor(getContainer().deps.db, session.user.id);
  if (!actor || actor.kind !== 'user' || actor.status !== 'ACTIVE') return null;
  const twoFactorEnabled = Boolean(session.user.twoFactorEnabled);
  return {
    actor,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled,
    twoFactor: twoFactorGate(
      actor.role,
      twoFactorEnabled,
      getContainer().env.TWO_FACTOR_ENFORCEMENT,
    ),
  };
});
