import type { DbTransaction, StageCategory } from '@docline/db';
import { evaluateChannel, loadGateInput, type GateChannel } from '../../compliance';
import { evaluateEligibility, type IneligibilityReason } from '../domain/eligibility';

/** Situações em que uma campanha segura os seus leads aptos (ver `holdsLeads`). */
export const HOLDING_STATUSES = ['READY', 'ACTIVE', 'PAUSED'] as const;

export interface EligibilityCampaign {
  id: string;
  channel: GateChannel;
  minDaysSinceLastContact: number;
  sdrIds: readonly string[];
}

export interface LeadEligibility {
  leadId: string;
  ownerId: string | null;
  priority: number;
  reasons: IneligibilityReason[];
}

/**
 * Elegibilidade de um lote de leads para a campanha: as consultas de
 * oportunidade, cadência e outras campanhas vão em lote; o gate do canal é o
 * de sempre, lead a lead (modo assistido; o modo API exige ainda opt-in ou
 * janela aberta, conferidos na hora de cada envio).
 */
export async function evaluateLeads(
  tx: DbTransaction,
  campaign: EligibilityCampaign,
  leadIds: readonly string[],
  now: Date,
): Promise<LeadEligibility[]> {
  if (leadIds.length === 0) return [];
  const ids = [...leadIds];
  const leads = await tx.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      ownerId: true,
      score: true,
      lastContactAt: true,
      stage: { select: { category: true } },
    },
  });
  const openOpportunities = await tx.opportunity.findMany({
    where: { leadId: { in: ids }, status: 'OPEN' },
    select: { leadId: true },
  });
  const ongoing = await tx.cadenceEnrollment.findMany({
    where: { leadId: { in: ids }, status: { in: ['ACTIVE', 'PAUSED'] } },
    select: { leadId: true },
  });
  const elsewhere = await tx.campaignLead.findMany({
    where: {
      leadId: { in: ids },
      campaignId: { not: campaign.id },
      eligibility: 'ELIGIBLE',
      status: { in: ['PENDING', 'RELEASED'] },
      campaign: { status: { in: [...HOLDING_STATUSES] } },
    },
    select: { leadId: true },
  });
  const withOpportunity = new Set(openOpportunities.map((o) => o.leadId));
  const inCadence = new Set(ongoing.map((e) => e.leadId));
  const inOtherCampaign = new Set(elsewhere.map((c) => c.leadId));
  const sdrs = new Set(campaign.sdrIds);

  const result: LeadEligibility[] = [];
  for (const lead of leads) {
    const gate = evaluateChannel(await loadGateInput(tx, lead.id, now), campaign.channel);
    const reasons = evaluateEligibility({
      gateCodes: gate.codes,
      stageCategory: (lead.stage?.category ?? null) as StageCategory | null,
      hasOpenOpportunity: withOpportunity.has(lead.id),
      hasOngoingEnrollment: inCadence.has(lead.id),
      inOtherCampaign: inOtherCampaign.has(lead.id),
      lastContactAt: lead.lastContactAt,
      minDaysSinceLastContact: campaign.minDaysSinceLastContact,
      ownedByOther: lead.ownerId !== null && !sdrs.has(lead.ownerId),
      now,
    });
    result.push({
      leadId: lead.id,
      ownerId: lead.ownerId,
      priority: lead.score ?? 0,
      reasons,
    });
  }
  return result;
}
