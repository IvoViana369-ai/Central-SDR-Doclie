import {
  listDataSubjectRequests,
  listLegalBasisAssessments,
  listSuppressions,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { ComplianceCenter } from '@/components/compliance/compliance-center';
import { getPageContext, loadIfAllowed } from '@/server/page-context';

export const metadata: Metadata = { title: 'Conformidade' };

export default async function CompliancePage() {
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  const can = (permission: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(actor.role, permission);
  const result = await loadIfAllowed(() =>
    Promise.all([
      listSuppressions(deps, actor, {}, meta),
      can('dsr.manage') ? listDataSubjectRequests(deps, actor, {}, meta) : Promise.resolve(null),
      listLegalBasisAssessments(deps, actor, {}, meta),
    ]),
  );
  if (!result.ok) return <AccessDenied />;
  const [suppressions, requests, assessments] = result.data;

  return (
    <ComplianceCenter
      suppressions={suppressions}
      requests={requests?.data ?? null}
      assessments={assessments}
      permissions={{
        canAdd: can('optout.register'),
        canRevoke: can('suppression.revoke'),
        canManageRequests: can('dsr.manage'),
        canManageAssessments: can('settings.manage'),
      }}
    />
  );
}
