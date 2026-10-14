import { getDuplicate, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { DuplicateCompare } from '@/components/dedup/duplicate-compare';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Comparar duplicados' };

export default async function DuplicatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'duplicate.decide')) return <AccessDenied />;
  const detail = await loadLead(() => getDuplicate(deps, user.actor, { candidateId: id }, meta));
  if (!detail) notFound();
  return <DuplicateCompare detail={detail} />;
}
