import 'server-only';
import { resolveActor, type Actor } from '@docline/core';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth } from './auth';
import { getContainer } from './container';

export interface SessionUser {
  actor: Extract<Actor, { kind: 'user' }>;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
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
  return {
    actor,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
  };
});
