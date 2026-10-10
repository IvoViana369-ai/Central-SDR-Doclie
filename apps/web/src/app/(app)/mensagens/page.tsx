import { listMessages, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { MESSAGE_VIEWS, type MessageViewKey } from '@/components/sdr/message-views';
import { MessagesView } from '@/components/sdr/messages-view';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Mensagens' };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  const requested = (await searchParams).view;
  const view: MessageViewKey =
    MESSAGE_VIEWS.find((v) => v.key === requested)?.key ?? MESSAGE_VIEWS[0].key;
  const result = await loadIfAllowed(() => listMessages(deps, actor, { view }, meta));
  if (!result.ok) return <AccessDenied />;

  return (
    <MessagesView
      key={view}
      view={view}
      initial={result.data}
      canEdit={roleHasPermission(actor.role, 'lead.update')}
    />
  );
}
