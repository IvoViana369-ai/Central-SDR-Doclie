import { canEditSettings, canEditStructure } from '@docline/core/campaigns-domain';
import { getCampaign, roleHasPermission } from '@docline/core';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/access-denied';
import { CampaignForm } from '@/components/campaigns/campaign-form';
import { PageHeader } from '@/components/page-header';
import { loadCampaignFormOptions } from '@/server/campaigns';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Editar campanha' };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'campaign.manage')) return <AccessDenied />;
  const detail = await loadLead(() => getCampaign(deps, user.actor, { campaignId: id }, meta));
  if (!detail) notFound();
  const { campaign } = detail;
  if (!canEditSettings(campaign.status)) redirect(`/campanhas/${campaign.id}`);
  const options = await loadCampaignFormOptions(user, deps, meta);
  return (
    <>
      <PageHeader title={`Editar: ${campaign.name}`} />
      <CampaignForm
        options={options}
        currentUserId={user.actor.id}
        structureLocked={!canEditStructure(campaign.status)}
        initial={{
          id: campaign.id,
          version: campaign.version,
          status: campaign.status,
          name: campaign.name,
          objective: campaign.objective,
          ownerId: campaign.ownerId,
          channel: campaign.channel as 'WHATSAPP',
          cadenceId: campaign.cadenceId,
          sdrIds: campaign.sdrs.map((s) => s.id),
          dailyContactLimit: campaign.dailyContactLimit,
          minDaysSinceLastContact: campaign.minDaysSinceLastContact,
          approachIds: detail.variants.map((v) => v.approach.id),
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          selection: campaign.selection,
          filterLabel: campaign.filterLabel,
        }}
      />
    </>
  );
}
