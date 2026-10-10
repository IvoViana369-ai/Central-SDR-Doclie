import { getContactRules, getMyQueue, listUsers, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { QueueView } from '@/components/sdr/queue-view';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Minha Fila' };

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  const privileged = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const users = privileged ? await listUsers(deps, actor, { status: 'ACTIVE' }, meta) : null;
  // Gestor e ADMIN escolhem de quem é a fila; um id fora da lista volta para a própria.
  const requested = (await searchParams).userId;
  const userId =
    typeof requested === 'string' && users?.some((u) => u.id === requested) ? requested : undefined;

  const result = await loadIfAllowed(() =>
    Promise.all([
      getMyQueue(deps, actor, { userId }, meta),
      getContactRules(deps, actor, {}, meta),
    ]),
  );
  if (!result.ok) return <AccessDenied />;
  const [queue, rules] = result.data;

  return (
    <QueueView
      queue={queue}
      self={{ id: actor.id, name: user.name }}
      users={users ? users.map((u) => ({ id: u.id, name: u.name })) : null}
      optOutKeywords={rules.optOutKeywords}
      canAct={roleHasPermission(actor.role, 'lead.update')}
    />
  );
}
