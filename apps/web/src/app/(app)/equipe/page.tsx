import { listUsers, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { TeamManager } from '@/components/team/team-manager';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Equipe' };

export default async function TeamPage() {
  const { user, deps, meta } = await getPageContext();
  const result = await loadIfAllowed(() => listUsers(deps, user.actor, {}, meta));
  if (!result.ok) return <AccessDenied />;

  return (
    <TeamManager
      users={result.data}
      currentUserId={user.actor.id}
      canManage={roleHasPermission(user.actor.role, 'user.manage')}
    />
  );
}
