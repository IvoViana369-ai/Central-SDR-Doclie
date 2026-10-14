import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const now = new Date('2026-10-13T12:00:00Z');

let seq = 0;
async function createUser(role: 'MANAGER' | 'SDR') {
  seq += 1;
  return db.user.create({
    data: { name: `Pessoa Fictícia ${seq}`, email: `pessoa${seq}-${Date.now()}@example.com`, role },
  });
}

async function createLead(name: string) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
  return db.lead.create({
    data: {
      displayName: name,
      nameSearch: name.toLowerCase(),
      nameCore: name.toLowerCase(),
      originSourceId: source.id,
      collectedAt: now,
      isTestData: true,
    },
  });
}

async function createCampaign(ownerId: string) {
  return db.campaign.create({
    data: {
      name: 'Campanha fictícia',
      filterDefinition: { filter: { field: 'state', op: 'eq', value: 'CE' } },
      channel: 'WHATSAPP',
      ownerId,
      dailyContactLimit: 10,
    },
  });
}

describe('schema das campanhas (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('campanha em rascunho com SDRs, variantes A/B sem repetir letra nem abordagem', async () => {
    const manager = await createUser('MANAGER');
    const sdr = await createUser('SDR');
    const campaign = await createCampaign(manager.id);
    expect(campaign).toMatchObject({
      status: 'DRAFT',
      minDaysSinceLastContact: 30,
      version: 1,
      snapshotAt: null,
    });
    await db.campaignSdr.create({ data: { campaignId: campaign.id, userId: sdr.id } });
    await expect(
      db.campaignSdr.create({ data: { campaignId: campaign.id, userId: sdr.id } }),
    ).rejects.toThrow();

    const a = await db.approach.create({ data: { key: 'PARCERIA', name: 'Parceria' } });
    const b = await db.approach.create({ data: { key: 'ECONOMIA', name: 'Economia' } });
    await db.campaignVariant.create({
      data: { campaignId: campaign.id, label: 'A', approachId: a.id },
    });
    await db.campaignVariant.create({
      data: { campaignId: campaign.id, label: 'B', approachId: b.id },
    });
    await expect(
      db.campaignVariant.create({
        data: { campaignId: campaign.id, label: 'A', approachId: b.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.campaignVariant.create({
        data: { campaignId: campaign.id, label: 'C', approachId: a.id },
      }),
    ).rejects.toThrow();
    // Abordagem em uso numa campanha não pode ser apagada.
    await expect(db.approach.delete({ where: { id: a.id } })).rejects.toThrow();
  });

  it('um registro por lead na campanha, com motivos; apagar a campanha leva junto o que é dela', async () => {
    const manager = await createUser('MANAGER');
    const sdr = await createUser('SDR');
    const campaign = await createCampaign(manager.id);
    const lead = await createLead('Escritório Campanha');
    const approach = await db.approach.create({ data: { key: 'PARCERIA', name: 'Parceria' } });
    const variant = await db.campaignVariant.create({
      data: { campaignId: campaign.id, label: 'A', approachId: approach.id },
    });
    await db.campaignLead.create({
      data: {
        campaignId: campaign.id,
        leadId: lead.id,
        eligibility: 'ELIGIBLE',
        assignedToId: sdr.id,
        variantId: variant.id,
        addedAt: now,
      },
    });
    await expect(
      db.campaignLead.create({
        data: { campaignId: campaign.id, leadId: lead.id, eligibility: 'ELIGIBLE', addedAt: now },
      }),
    ).rejects.toThrow();
    const other = await createLead('Escritório Fora');
    const ineligible = await db.campaignLead.create({
      data: {
        campaignId: campaign.id,
        leadId: other.id,
        eligibility: 'INELIGIBLE',
        ineligibilityReasons: ['SUPPRESSED', 'NO_CHANNEL_CONTACT'],
        addedAt: now,
      },
    });
    expect(ineligible).toMatchObject({
      status: 'PENDING',
      ineligibilityReasons: ['SUPPRESSED', 'NO_CHANNEL_CONTACT'],
    });

    // A inscrição e a mensagem guardam a campanha; apagar a campanha não apaga o histórico do lead.
    const cadence = await db.cadence.findFirstOrThrow({ where: { isDefault: true } });
    const enrollment = await db.cadenceEnrollment.create({
      data: {
        leadId: lead.id,
        cadenceId: cadence.id,
        cadenceVersion: 1,
        enrolledAt: now,
        campaignId: campaign.id,
      },
    });
    const message = await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        mode: 'ASSISTED',
        status: 'SENT',
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
      },
    });
    await db.campaignLead.update({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
      data: { status: 'RELEASED', releasedAt: now, enrollmentId: enrollment.id },
    });

    await db.campaign.delete({ where: { id: campaign.id } });
    expect(await db.campaignLead.count()).toBe(0);
    expect(await db.campaignVariant.count()).toBe(0);
    expect(
      await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } }),
    ).toMatchObject({ campaignId: null });
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      campaignId: null,
    });
    expect(await db.lead.count()).toBe(2);
  });

  it('distribuição por campanha é uma estratégia de atribuição', async () => {
    const manager = await createUser('MANAGER');
    const sdr = await createUser('SDR');
    const lead = await createLead('Escritório Distribuído');
    const assignment = await db.leadAssignment.create({
      data: {
        leadId: lead.id,
        toUserId: sdr.id,
        strategy: 'CAMPAIGN',
        assignedById: manager.id,
        assignedAt: now,
      },
    });
    expect(assignment.strategy).toBe('CAMPAIGN');
  });
});
