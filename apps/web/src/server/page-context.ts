import 'server-only';
import { ForbiddenError, type CoreDeps, type RequestMeta } from '@docline/core';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getContainer } from './container';
import { ipAddressOptions, requestMetaFrom } from './request-meta';
import { getSessionUser, type SessionUser } from './session';

/** Contexto para páginas autenticadas (Server Components). */
export async function getPageContext(): Promise<{
  user: SessionUser;
  deps: CoreDeps;
  meta: RequestMeta;
}> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { deps, env } = getContainer();
  const meta = requestMetaFrom(await headers(), ipAddressOptions(env.TRUSTED_PROXIES));
  return { user, deps, meta };
}

/**
 * Executa a leitura de uma página; se o perfil não tiver permissão (a negação é
 * auditada pelo core), devolve `{ ok: false }` para a página exibir "Acesso restrito".
 */
export async function loadIfAllowed<T>(
  load: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false };
    throw error;
  }
}
