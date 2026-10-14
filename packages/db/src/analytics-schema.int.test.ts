import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const at = (iso: string) => new Date(iso);

let seq = 0;
async function createUser(role: 'MANAGER' | 'SDR' | 'SALES' = 'SDR') {
  seq += 1;
  return db.user.create({
    data: {
      name: `Pessoa Fictícia ${seq}`,
      email: `fase11-${seq}-${Date.now()}@example.com`,
      role,
    },
  });
}

async function createLead(name: string, extra: { firstContactAt?: Date; ownerId?: string } = {}) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
  return db.lead.create({
    data: {
      displayName: name,
      nameSearch: name.toLowerCase(),
      nameCore: name.toLowerCase(),
      originSourceId: source.id,
      collectedAt: at('2026-10-01T12:00:00Z'),
      createdAt: at('2026-10-01T12:00:00Z'),
      firstContactAt: extra.firstContactAt ?? null,
      ownerId: extra.ownerId ?? null,
      isTestData: true,
    },
  });
}

type FactRow = {
  lead_id: string;
  first_contact_channel: string | null;
  first_contact_approach_id: string | null;
  first_contact_user_id: string | null;
  first_contact_campaign_id: string | null;
  first_reply_at: Date | null;
  first_interested_at: Date | null;
  first_opportunity_at: Date | null;
  won_at: Date | null;
  conversion_type: string | null;
  opted_out_at: Date | null;
};

const facts = async () => {
  await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_lead_facts');
  return db.$queryRawUnsafe<FactRow[]>('SELECT * FROM analytics_lead_facts');
};

describe('schema de analytics (Fase 11)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('rollup diário: uma linha por dia, recorte e chave; contagens começam em zero', async () => {
    const day = at('2026-10-13T00:00:00Z');
    const row = await db.dailyMetric.create({
      data: { date: day, dimension: 'GLOBAL', computedAt: at('2026-10-13T12:00:00Z') },
    });
    expect(row).toMatchObject({ dimensionId: '', newLeads: 0, messagesOut: 0, optOuts: 0 });
    await db.dailyMetric.create({
      data: { date: day, dimension: 'CHANNEL', dimensionId: 'WHATSAPP', computedAt: day },
    });
    await expect(
      db.dailyMetric.create({ data: { date: day, dimension: 'GLOBAL', computedAt: day } }),
    ).rejects.toThrow();
  });

  it('usuário: entra na distribuição por padrão, sem teto próprio nem ausência', async () => {
    const sdr = await createUser();
    expect(sdr).toMatchObject({ autoAssign: true, maxActiveLeads: null, awayUntil: null });
    const away = await db.user.update({
      where: { id: sdr.id },
      data: { awayUntil: at('2026-10-20T00:00:00Z'), maxActiveLeads: 80 },
    });
    expect(away.awayUntil?.toISOString().slice(0, 10)).toBe('2026-10-20');
  });

  it('insights: da equipe ou da carteira, geração da IA sem lead, e o que acontece ao apagar', async () => {
    const manager = await createUser('MANAGER');
    const sdr = await createUser();
    const generation = await db.aiGeneration.create({
      data: {
        kind: 'INSIGHT',
        promptId: 'portfolio-insights',
        promptVersion: 1,
        provider: 'fake',
        model: 'fake-model',
        params: {},
        inputSnapshot: { facts: [] },
        status: 'GENERATED',
      },
    });
    expect(generation.leadId).toBeNull();
    const base = {
      generatedAt: at('2026-10-13T10:00:00Z'),
      validUntil: at('2026-10-14T10:00:00Z'),
      type: 'PRIORITY_TO_CONTACT',
      text: 'Hoje há 3 escritórios prioritários para contato.',
      data: { count: 3 },
    };
    const team = await db.insight.create({
      data: { ...base, scope: 'TEAM', source: 'AI', aiGenerationId: generation.id },
    });
    await db.insight.create({
      data: { ...base, scope: 'USER', audienceUserId: sdr.id, source: 'TEMPLATE' },
    });
    await db.insight.update({
      where: { id: team.id },
      data: { feedback: 'USEFUL', feedbackById: manager.id, feedbackAt: base.generatedAt },
    });

    await db.aiGeneration.delete({ where: { id: generation.id } });
    expect(await db.insight.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({
      aiGenerationId: null,
      feedback: 'USEFUL',
    });
    await db.user.delete({ where: { id: manager.id } });
    expect(
      (await db.insight.findUniqueOrThrow({ where: { id: team.id } })).feedbackById,
    ).toBeNull();
    // O insight da carteira sai com a pessoa.
    await db.user.delete({ where: { id: sdr.id } });
    expect(await db.insight.count({ where: { scope: 'USER' } })).toBe(0);
  });

  it('fatos por lead: canal, abordagem, quem e campanha do 1º contato e os marcos depois dele', async () => {
    const sdr = await createUser();
    const manager = await createUser('MANAGER');
    const approach = await db.approach.create({ data: { key: 'F11_PARCERIA', name: 'Parceria' } });
    const firstContactAt = at('2026-10-05T13:00:00Z');
    const lead = await createLead('Escritório Fatos', { firstContactAt, ownerId: sdr.id });
    const campaign = await db.campaign.create({
      data: {
        name: 'Campanha fictícia',
        filterDefinition: {},
        channel: 'WHATSAPP',
        ownerId: manager.id,
        dailyContactLimit: 5,
      },
    });
    await db.campaignLead.create({
      data: {
        campaignId: campaign.id,
        leadId: lead.id,
        eligibility: 'ELIGIBLE',
        status: 'RELEASED',
        addedAt: at('2026-10-04T12:00:00Z'),
        releasedAt: at('2026-10-04T12:00:00Z'),
      },
    });
    // Ligação atendida depois da mensagem: o 1º contato é a mensagem.
    await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        mode: 'ASSISTED',
        status: 'SENT',
        sentAt: firstContactAt,
        sentById: sdr.id,
        approachId: approach.id,
      },
    });
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: sdr.id,
        type: 'CALL',
        direction: 'OUTBOUND',
        outcome: 'CONNECTED',
        occurredAt: at('2026-10-06T13:00:00Z'),
      },
    });
    // Resposta antes do 1º contato não conta; a seguinte, sim.
    await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        mode: 'ASSISTED',
        status: 'RECEIVED',
        receivedAt: at('2026-10-02T13:00:00Z'),
      },
    });
    await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        mode: 'ASSISTED',
        status: 'RECEIVED',
        receivedAt: at('2026-10-07T13:00:00Z'),
        classification: 'INTERESTED',
      },
    });
    await db.opportunity.create({
      data: {
        leadId: lead.id,
        sdrId: sdr.id,
        status: 'WON',
        handoffAt: at('2026-10-08T13:00:00Z'),
        acceptDueAt: at('2026-10-09T13:00:00Z'),
        qualification: {},
        wonAt: at('2026-10-10T13:00:00Z'),
        conversionType: 'PARTNER',
      },
    });
    await db.suppressionEntry.create({
      data: {
        type: 'LEAD',
        valueHash: `lead:${lead.id}`,
        valueMasked: 'Lead',
        reason: 'OPT_OUT',
        source: 'SDR',
        leadId: lead.id,
        createdAt: at('2026-10-11T13:00:00Z'),
      },
    });
    // Sem contato: só aparece com o resto vazio. Mesclado: fica de fora.
    const untouched = await createLead('Escritório Parado');
    const merged = await createLead('Escritório Mesclado');
    await db.lead.update({ where: { id: merged.id }, data: { status: 'MERGED' } });

    const rows = await facts();
    expect(rows.map((r) => r.lead_id).sort()).toEqual([lead.id, untouched.id].sort());
    const fact = rows.find((r) => r.lead_id === lead.id)!;
    expect(fact).toMatchObject({
      first_contact_channel: 'WHATSAPP',
      first_contact_approach_id: approach.id,
      first_contact_user_id: sdr.id,
      first_contact_campaign_id: campaign.id,
      first_reply_at: at('2026-10-07T13:00:00Z'),
      first_interested_at: at('2026-10-07T13:00:00Z'),
      first_opportunity_at: at('2026-10-08T13:00:00Z'),
      won_at: at('2026-10-10T13:00:00Z'),
      conversion_type: 'PARTNER',
      opted_out_at: at('2026-10-11T13:00:00Z'),
    });
    expect(rows.find((r) => r.lead_id === untouched.id)).toMatchObject({
      first_contact_channel: null,
      first_reply_at: null,
      won_at: null,
    });

    // Fora da janela de 90 dias da liberação, o 1º contato não é da campanha.
    await db.campaignLead.update({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
      data: { releasedAt: at('2026-06-01T12:00:00Z') },
    });
    expect(
      (await facts()).find((r) => r.lead_id === lead.id)?.first_contact_campaign_id,
    ).toBeNull();
  });
});
