import { listDuplicates } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { DuplicateQueue } from '@/components/dedup/duplicate-queue';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Duplicados' };

export default async function DuplicatesPage() {
  const { user, deps, meta } = await getPageContext();
  const result = await loadIfAllowed(() => listDuplicates(deps, user.actor, {}, meta));
  if (!result.ok) return <AccessDenied />;
  return <DuplicateQueue initial={result.data} />;
}
