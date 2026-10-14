import 'server-only';
import {
  listUsers,
  NotFoundError,
  roleHasPermission,
  ValidationError,
  type CoreDeps,
  type RequestMeta,
} from '@docline/core';
import type { SessionUser } from './session';

export interface AnalyticsParams {
  from?: string;
  to?: string;
  userId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** Filtros das telas de indicadores (?de=AAAA-MM-DD&ate=AAAA-MM-DD&pessoa=<id>). */
export function readAnalyticsParams(
  search: Record<string, string | string[] | undefined>,
): AnalyticsParams {
  const person = first(search.pessoa);
  return {
    from: first(search.de),
    to: first(search.ate),
    userId: person && UUID.test(person) ? person : undefined,
  };
}

/**
 * Carrega os indicadores; período inválido ou pessoa inexistente voltam ao
 * padrão (últimos 30 dias, equipe) com um aviso, em vez de quebrar a página.
 */
export async function loadAnalytics<T>(
  params: AnalyticsParams,
  load: (input: AnalyticsParams) => Promise<T>,
): Promise<{ data: T; notice: string | null }> {
  try {
    return { data: await load(params), notice: null };
  } catch (error) {
    if (error instanceof ValidationError) {
      const message = error.issues[0]?.message ?? 'Período inválido.';
      return { data: await load({}), notice: `${message} Mostrando os últimos 30 dias.` };
    }
    if (error instanceof NotFoundError) {
      return { data: await load({ from: params.from, to: params.to }), notice: error.message };
    }
    throw error;
  }
}

/** Pessoas do filtro (só para quem vê a equipe). */
export async function analyticsPeople(user: SessionUser, deps: CoreDeps, meta: RequestMeta) {
  if (!roleHasPermission(user.actor.role, 'report.read')) return undefined;
  if (!roleHasPermission(user.actor.role, 'user.read')) return [];
  const users = await listUsers(deps, user.actor, { status: 'ACTIVE' }, meta);
  return users
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
