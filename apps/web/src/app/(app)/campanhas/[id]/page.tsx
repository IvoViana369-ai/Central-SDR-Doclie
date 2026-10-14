import { getCampaign, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { CampaignActions } from '@/components/campaigns/campaign-actions';
import { CampaignDetailView } from '@/components/campaigns/campaign-detail';
import { CampaignStatusBadge } from '@/components/campaigns/status-badge';
import { PageHeader } from '@/components/page-header';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Campanha' };

/** Campanha: configuração, retrato com motivos, distribuição, funil e A/B (F10-01 a F10-05). */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'campaign.manage')) return <AccessDenied />;
  const detail = await loadLead(() => getCampaign(deps, user.actor, { campaignId: id }, meta));
  if (!detail) notFound();
  const { campaign } = detail;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/campanhas" className="text-muted-foreground hover:underline">
          ← Campanhas
        </Link>
      </p>
      <PageHeader
        title={campaign.name}
        description={
          <span className="flex items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            {campaign.createdBy ? `Criada por ${campaign.createdBy.name}` : null}
          </span>
        }
        actions={
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            version={campaign.version}
          />
        }
      />
      <CampaignDetailView detail={detail} />
    </>
  );
}
