import {
  getPipelineBoard,
  listLeadSources,
  listLossReasons,
  listStates,
  listTags,
  listUsers,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { PipelineBoard } from '@/components/pipeline/pipeline-board';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  const result = await loadIfAllowed(() =>
    Promise.all([
      getPipelineBoard(deps, actor, {}, meta),
      listLossReasons(deps, actor, {}, meta),
      listStates(deps, actor, {}, meta),
      listLeadSources(deps, actor, {}, meta),
      listTags(deps, actor, {}, meta),
      roleHasPermission(actor.role, 'lead.assign')
        ? listUsers(deps, actor, { status: 'ACTIVE' }, meta)
        : Promise.resolve(null),
    ]),
  );
  if (!result.ok) return <AccessDenied />;
  const [board, lossReasons, states, sources, tags, users] = result.data;

  return (
    <PipelineBoard
      initial={board}
      lossReasons={lossReasons}
      options={{
        states,
        sources,
        tags,
        ...(users ? { owners: users.map((u) => ({ id: u.id, name: u.name })) } : {}),
      }}
      permissions={{
        canMove: roleHasPermission(actor.role, 'lead.update'),
        privileged: actor.role === 'ADMIN' || actor.role === 'MANAGER',
      }}
    />
  );
}
