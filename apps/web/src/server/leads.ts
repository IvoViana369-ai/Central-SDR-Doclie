import 'server-only';
import {
  listLeadSources,
  listSegments,
  listTags,
  listUsers,
  roleHasPermission,
  type CoreDeps,
  type RequestMeta,
} from '@docline/core';
import type { SessionUser } from './session';

/** Opções dos formulários de lead (origens, segmentos, tags e, para quem atribui, responsáveis). */
export async function loadLeadFormOptions(user: SessionUser, deps: CoreDeps, meta: RequestMeta) {
  const actor = user.actor;
  const canAssign = roleHasPermission(actor.role, 'lead.assign');
  const [sources, segments, tags, users] = await Promise.all([
    listLeadSources(deps, actor, {}, meta),
    listSegments(deps, actor, {}, meta),
    listTags(deps, actor, {}, meta),
    canAssign ? listUsers(deps, actor, { status: 'ACTIVE' }, meta) : Promise.resolve(null),
  ]);
  return {
    sources,
    segments,
    tags,
    ...(users ? { owners: users.map((u) => ({ id: u.id, name: u.name, role: u.role })) } : {}),
  };
}
