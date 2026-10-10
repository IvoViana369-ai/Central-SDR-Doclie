import {
  countLeads,
  listLeadSources,
  listSavedViews,
  listSegments,
  listStates,
  listTags,
  listUsers,
  roleHasPermission,
  searchLeads,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { LeadsExplorer } from '@/components/leads/leads-explorer';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  const canAssign = roleHasPermission(actor.role, 'lead.assign');
  const result = await loadIfAllowed(() =>
    Promise.all([
      searchLeads(deps, actor, {}, meta),
      countLeads(deps, actor, {}, meta),
      listStates(deps, actor, {}, meta),
      listLeadSources(deps, actor, {}, meta),
      listSegments(deps, actor, {}, meta),
      listTags(deps, actor, {}, meta),
      listSavedViews(deps, actor, {}, meta),
      canAssign ? listUsers(deps, actor, { status: 'ACTIVE' }, meta) : Promise.resolve(null),
    ]),
  );
  if (!result.ok) return <AccessDenied />;
  const [page, count, states, sources, segments, tags, views, users] = result.data;

  return (
    <LeadsExplorer
      initial={page}
      initialCount={count}
      options={{
        states,
        sources,
        segments,
        tags,
        views,
        ...(users ? { owners: users.map((u) => ({ id: u.id, name: u.name })) } : {}),
      }}
      permissions={{
        canCreate: roleHasPermission(actor.role, 'lead.create'),
        canBulk: roleHasPermission(actor.role, 'lead.bulk'),
        canAssign,
        canManageTags: roleHasPermission(actor.role, 'tag.manage'),
        canExport: roleHasPermission(actor.role, 'lead.export'),
        canCampaign: roleHasPermission(actor.role, 'campaign.manage'),
      }}
    />
  );
}
