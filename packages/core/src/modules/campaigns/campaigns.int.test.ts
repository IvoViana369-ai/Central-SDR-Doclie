import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JOBS } from '../../jobs/catalog';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { enrollLead } from '../cadence';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { confirmAssistedMessage, prepareAssistedMessage, recordReply } from '../messaging';
import { handoffToSales, markOpportunityWon } from '../opportunities';
import {
  campaignAction,
  createCampaign,
  getCampaign,
  getLeadCampaigns,
  listCampaignLeads,
  listCampaigns,
  removeCampaignLead,
  runCampaignBuild,
  runCampaignTick,
  updateCampaign,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 13/10, 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;

describe('campanhas (Fase 10)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdrA: UserActor;
  let sdrB: UserActor;
  let outsider: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let approachA: string;
  let approachB: string;
  let phone = 4100;

  const make = (name: string, extra: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99813-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
    ...extra,
  });
  const newLead = async (name: string, extra: Partial<CreateLeadInput> = {}) =>
    (await createLead(deps, manager, make(name, extra))).id;

  const baseCampaign = () => ({
    name: 'Sobral — parceria',
    objective: 'Apresentar a parceria aos escritórios de Sobral (teste).',
    channel: 'WHATSAPP' as const,
    sdrIds: [sdrA.id, sdrB.id],
    dailyContactLimit: 2,
    approachIds: [approachA, approachB],
    selection: {},
    filterLabel: 'Todos os leads ativos',
  });

  async function build(campaignId: string) {
    const current = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    await campaignAction(deps, manager, { campaignId, action: 'build', version: current.version });
    return runCampaignBuild(deps, { campaignId });
  }
  async function act(campaignId: string, action: 'activate' | 'pause' | 'resume' | 'complete') {
    const current = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    return campaignAction(deps, manager, { campaignId, action, version: current.version });
  }
  const rowsOf = (campaignId: string) =>
    db.campaignLead.findMany({
      where: { campaignId },
      include: { lead: { select: { displayName: true, ownerId: true } }, variant: true },
    });
  const rowOf = async (campaignId: string, leadId: string) =>
    db.campaignLead.findUniqueOrThrow({
      where: { campaignId_leadId: { campaignId, leadId } },
    });

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    enqueued.length = 0;
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdrA = (await createActor('SDR')).actor as UserActor;
    sdrB = (await createActor('SDR')).actor as UserActor;
    outsider = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
    approachA = (await db.approach.create({ data: { key: 'TESTE_PARCERIA', name: 'Parceria' } }))
      .id;
    approachB = (await db.approach.create({ data: { key: 'TESTE_ECONOMIA', name: 'Economia' } }))
      .id;
  });
  afterAll(() => closeTestDb());

  it('cria em rascunho só com gestor/ADMIN e confere SDRs, abordagens, datas e filtro', async () => {
    await expect(createCampaign(deps, sdrA, baseCampaign())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCampaign(deps, manager, { ...baseCampaign(), sdrIds: [sdrA.id, sales.id] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCampaign(deps, manager, {
        ...baseCampaign(),
        selection: { filter: { field: 'naoExiste', op: 'eq', value: 'x' } as never },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCampaign(deps, manager, {
        ...baseCampaign(),
        startsAt: new Date('2026-10-20T00:00:00Z'),
        endsAt: new Date('2026-10-19T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCampaign(deps, manager, { ...baseCampaign(), dailyContactLimit: 500 }),
    ).rejects.toBeInstanceOf(ValidationError);

    const { campaignId } = await createCampaign(deps, manager, baseCampaign());
    const campaign = await db.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { sdrs: true, variants: { orderBy: { label: 'asc' } } },
    });
    expect(campaign).toMatchObject({
      status: 'DRAFT',
      ownerId: manager.id,
      createdById: manager.id,
      minDaysSinceLastContact: 30,
      version: 1,
    });
    expect(campaign.sdrs).toHaveLength(2);
    expect(campaign.variants.map((v) => [v.label, v.approachId])).toEqual([
      ['A', approachA],
      ['B', approachB],
    ]);
    expect(await db.campaignLead.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'campaign.create' } })).toBe(1);
    const list = await listCampaigns(deps, admin, {});
    expect(list.items).toMatchObject([{ id: campaignId, status: 'DRAFT', sdrs: 2, variants: 2 }]);
  });

  it('monta o retrato com motivos, distribui os aptos e sorteia as variantes', async () => {
    const pool = [];
    for (const name of ['Escritório Aroeira', 'Escritório Baraúna', 'Escritório Cajueiro']) {
      pool.push(await newLead(name));
    }
    const ofSdrB = await newLead('Escritório Juazeiro', { ownerId: sdrB.id });
    const ofOutsider = await newLead('Escritório Mandacaru', { ownerId: outsider.id });
    const optedOut = await newLead('Escritório Oiticica');
    await registerOptOut(deps, manager, { leadId: optedOut });
    const emailOnly = await newLead('Escritório Pau-Ferro', {
      contactPoints: [{ type: 'EMAIL', value: 'contato@pauferro.example.com' }],
    });
    const inCadence = await newLead('Escritório Sabiá');
    await enrollLead(deps, manager, { leadId: inCadence });
    const recent = await newLead('Escritório Timbaúba');
    await db.lead.update({
      where: { id: recent },
      data: { lastContactAt: new Date('2026-10-08T12:00:00Z') },
    });
    const reserved = await newLead('Escritório Ipê-Roxo');

    // Outra campanha pronta segura o "Ipê-Roxo".
    const other = await createCampaign(deps, manager, {
      ...baseCampaign(),
      name: 'Só o Ipê',
      sdrIds: [sdrA.id],
      approachIds: [],
      selection: { q: 'Ipê-Roxo' },
    });
    expect(await build(other.campaignId)).toMatchObject({ status: 'ready' });

    const { campaignId } = await createCampaign(deps, manager, baseCampaign());
    await campaignAction(deps, manager, { campaignId, action: 'build', version: 1 });
    expect(await db.campaign.findUniqueOrThrow({ where: { id: campaignId } })).toMatchObject({
      status: 'BUILDING',
    });
    expect(enqueued.filter((j) => j.name === JOBS.campaignBuild.name).at(-1)).toMatchObject({
      data: { campaignId },
      options: { singletonKey: `campaign-build:${campaignId}` },
    });
    // Editar durante a montagem não pode.
    await expect(
      updateCampaign(deps, manager, { campaignId, version: 2, name: 'Outro nome' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    const built = await runCampaignBuild(deps, { campaignId });
    expect(built).toMatchObject({ status: 'ready', stats: { selected: 10, eligible: 4 } });

    const rows = await rowsOf(campaignId);
    const reasonsOf = (leadId: string) =>
      rows.find((r) => r.leadId === leadId)!.ineligibilityReasons;
    expect(reasonsOf(ofOutsider)).toEqual(['OWNED_BY_OTHER']);
    expect(reasonsOf(optedOut)).toContain('SUPPRESSED');
    expect(reasonsOf(emailOnly)).toEqual(['NO_CHANNEL_CONTACT']);
    expect(reasonsOf(inCadence)).toEqual(['IN_CADENCE']);
    expect(reasonsOf(recent)).toEqual(['RECENT_CONTACT']);
    expect(reasonsOf(reserved)).toEqual(['OTHER_CAMPAIGN']);
    for (const row of rows.filter((r) => r.eligibility === 'INELIGIBLE')) {
      expect(row).toMatchObject({ status: 'SKIPPED', assignedToId: null, variantId: null });
    }

    // O lead da Bia fica com ela; o pool vai para quem tem menos.
    const eligible = rows.filter((r) => r.eligibility === 'ELIGIBLE');
    expect(eligible.map((r) => r.leadId).sort()).toEqual([...pool, ofSdrB].sort());
    expect(eligible.find((r) => r.leadId === ofSdrB)?.assignedToId).toBe(sdrB.id);
    const perSdr = (id: string) => eligible.filter((r) => r.assignedToId === id).length;
    expect([perSdr(sdrA.id), perSdr(sdrB.id)]).toEqual([2, 2]);
    // Cada SDR trabalha as duas abordagens.
    for (const sdr of [sdrA.id, sdrB.id]) {
      const labels = eligible.filter((r) => r.assignedToId === sdr).map((r) => r.variant?.label);
      expect(labels.sort()).toEqual(['A', 'B']);
    }
    // Montar não mexe em ninguém: o pool continua sem responsável.
    for (const leadId of pool) {
      expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).ownerId).toBeNull();
    }

    const detail = await getCampaign(deps, manager, { campaignId });
    expect(detail.campaign.status).toBe('READY');
    expect(detail.counts).toMatchObject({ selected: 10, eligible: 4, pending: 4, skipped: 6 });
    expect(detail.skippedReasons).toMatchObject({
      OWNED_BY_OTHER: 1,
      NO_CHANNEL_CONTACT: 1,
      IN_CADENCE: 1,
      RECENT_CONTACT: 1,
      OTHER_CAMPAIGN: 1,
    });
    const page = await listCampaignLeads(deps, manager, {
      campaignId,
      reason: 'RECENT_CONTACT',
    });
    expect(page).toMatchObject({ total: 1, items: [{ leadId: recent, status: 'SKIPPED' }] });
    // Pedido (quem clicou) e conclusão (o job), para cada uma das duas campanhas.
    expect(await db.auditLog.count({ where: { action: 'campaign.build' } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: 'campaign.build_completed' } })).toBe(2);
  });

  it('montagem sem lead no filtro volta ao rascunho com o erro registrado', async () => {
    const { campaignId } = await createCampaign(deps, manager, {
      ...baseCampaign(),
      selection: { q: 'Ninguém Com Este Nome' },
    });
    expect(await build(campaignId)).toMatchObject({ status: 'failed' });
    expect(await db.campaign.findUniqueOrThrow({ where: { id: campaignId } })).toMatchObject({
      status: 'DRAFT',
      buildError: expect.stringContaining('não traz nenhum lead'),
    });
    expect(await db.auditLog.count({ where: { action: 'campaign.build_failed' } })).toBe(1);
  });

  it('libera até o limite diário por SDR, só em dia útil, e confere tudo de novo na hora', async () => {
    const leads = [];
    for (const name of ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Foxtrot']) {
      leads.push(await newLead(`Escritório ${name}`));
    }
    const { campaignId } = await createCampaign(deps, manager, baseCampaign());
    await build(campaignId);
    expect((await getCampaign(deps, manager, { campaignId })).counts.pending).toBe(6);

    // O primeiro da fila do SDR A entrou na Lista Não Contatar depois da montagem.
    const late = await db.campaignLead.findFirstOrThrow({
      where: { campaignId, assignedToId: sdrA.id },
      orderBy: [{ priority: 'desc' }, { leadId: 'asc' }],
    });
    await registerOptOut(deps, manager, { leadId: late.leadId });

    enqueued.length = 0;
    await act(campaignId, 'activate');
    expect(enqueued).toMatchObject([{ name: JOBS.campaignTick.name, data: { campaignId } }]);
    const first = await runCampaignTick(deps, { campaignId });
    expect(first).toMatchObject({ released: 4, skipped: 1, errors: 0 });
    expect(await rowOf(campaignId, late.leadId)).toMatchObject({
      status: 'SKIPPED',
      ineligibilityReasons: expect.arrayContaining(['SUPPRESSED']),
    });

    const released = await db.campaignLead.findMany({
      where: { campaignId, status: 'RELEASED' },
      include: { enrollment: true },
    });
    expect(released).toHaveLength(4);
    for (const row of released) {
      const lead = await db.lead.findUniqueOrThrow({
        where: { id: row.leadId },
        include: { stage: true },
      });
      // Do pool para o SDR da campanha, com a cadência e a tarefa na fila dele.
      expect(lead.ownerId).toBe(row.assignedToId);
      expect(lead.stage?.key).toBe('AWAITING_OUTREACH');
      expect(row.enrollment).toMatchObject({ campaignId, status: 'ACTIVE' });
      expect(
        await db.task.findFirstOrThrow({ where: { leadId: row.leadId, status: 'OPEN' } }),
      ).toMatchObject({ assigneeId: row.assignedToId, type: 'FIRST_CONTACT' });
      expect(
        await db.leadAssignment.findFirstOrThrow({
          where: { leadId: row.leadId, strategy: 'CAMPAIGN' },
        }),
      ).toMatchObject({ toUserId: row.assignedToId });
      expect(
        await db.leadEvent.count({ where: { leadId: row.leadId, type: 'campaign.released' } }),
      ).toBe(1);
    }
    // Nenhuma mensagem foi enviada pela campanha.
    expect(await db.message.count()).toBe(0);

    // Mesma data: cota cheia.
    expect(await runCampaignTick(deps, { campaignId })).toMatchObject({ released: 0 });
    // Sábado: fora do expediente.
    at('2026-10-17T13:00:00Z');
    expect(await runCampaignTick(deps)).toMatchObject({ released: 0 });
    // Segunda: o que restou (um lead do SDR B; o do A foi o "não liberado").
    at('2026-10-19T12:00:00Z');
    expect(await runCampaignTick(deps)).toMatchObject({ released: 1 });
    expect((await getCampaign(deps, manager, { campaignId })).counts).toMatchObject({
      released: 5,
      pending: 0,
      skipped: 1,
    });
  });

  it('pausa, retoma, conclui e a data de fim conclui sozinha; retirar só quem aguarda', async () => {
    for (const name of ['Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis']) {
      await newLead(`Escritório ${name}`);
    }
    const { campaignId } = await createCampaign(deps, manager, {
      ...baseCampaign(),
      dailyContactLimit: 1,
      endsAt: new Date('2026-10-16T03:00:00Z'),
    });
    await build(campaignId);
    await act(campaignId, 'activate');
    await act(campaignId, 'pause');
    expect(await runCampaignTick(deps, { campaignId })).toMatchObject({ released: 0 });
    await act(campaignId, 'resume');
    expect(await runCampaignTick(deps, { campaignId })).toMatchObject({ released: 2 });

    const pending = await db.campaignLead.findFirstOrThrow({
      where: { campaignId, status: 'PENDING' },
    });
    await removeCampaignLead(deps, manager, { campaignId, leadId: pending.leadId });
    expect((await rowOf(campaignId, pending.leadId)).status).toBe('REMOVED');
    await expect(
      removeCampaignLead(deps, manager, { campaignId, leadId: pending.leadId }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    // Ativa: estrutura travada, ajustes livres.
    const version = (await db.campaign.findUniqueOrThrow({ where: { id: campaignId } })).version;
    await expect(
      updateCampaign(deps, manager, { campaignId, version, sdrIds: [sdrA.id] }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      updateCampaign(deps, manager, { campaignId, version: version - 1, dailyContactLimit: 3 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await updateCampaign(deps, manager, { campaignId, version, dailyContactLimit: 3 });

    // Passou do fim (16/10 00:00 em Fortaleza): o tick conclui e tira quem não foi liberado.
    at('2026-10-16T12:00:00Z');
    expect(await runCampaignTick(deps)).toMatchObject({ completed: 1, released: 0 });
    const done = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(done).toMatchObject({ status: 'COMPLETED' });
    expect(done.completedAt).toEqual(new Date('2026-10-16T12:00:00Z'));
    expect(await db.campaignLead.count({ where: { campaignId, status: 'PENDING' } })).toBe(0);
    await expect(act(campaignId, 'activate')).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('mudar a estrutura de uma campanha pronta descarta o retrato e volta ao rascunho', async () => {
    await newLead('Escritório Retrato');
    const { campaignId } = await createCampaign(deps, manager, baseCampaign());
    await build(campaignId);
    expect(await db.campaignLead.count({ where: { campaignId } })).toBe(1);
    const { version } = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const updated = await updateCampaign(deps, manager, {
      campaignId,
      version,
      channel: 'PHONE',
      approachIds: [approachB],
    });
    expect(updated.status).toBe('DRAFT');
    expect(await db.campaignLead.count({ where: { campaignId } })).toBe(0);
    expect(
      await db.campaignVariant.findMany({ where: { campaignId }, select: { label: true } }),
    ).toEqual([{ label: 'A' }]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'campaign.update' } });
    expect(audit.changes).toMatchObject({ channel: ['WHATSAPP', 'PHONE'] });
    expect(audit.metadata).toMatchObject({ snapshotDiscarded: true });
  });

  it('funil e A/B: marcos na janela de atribuição, sem declarar vencedora', async () => {
    const ids = [];
    for (const name of ['Aurora', 'Brisa', 'Cascata', 'Duna']) {
      ids.push(await newLead(`Escritório ${name}`));
    }
    const { campaignId } = await createCampaign(deps, manager, {
      ...baseCampaign(),
      dailyContactLimit: 5,
    });
    await build(campaignId);
    await act(campaignId, 'activate');
    await runCampaignTick(deps, { campaignId });
    const rows = await rowsOf(campaignId);
    const actorOf = (row: { assignedToId: string | null }) =>
      row.assignedToId === sdrA.id ? sdrA : sdrB;
    const [first, second, third] = rows;

    // 1º: contatado, respondeu com interesse, virou oportunidade ganha.
    at('2026-10-13T13:00:00Z');
    const prepared = await prepareAssistedMessage(deps, actorOf(first!), {
      leadId: first!.leadId,
      channel: 'WHATSAPP',
      body: 'Olá! Mensagem de teste da campanha.',
    });
    await confirmAssistedMessage(deps, actorOf(first!), { messageId: prepared.message.id });
    at('2026-10-13T14:00:00Z');
    await recordReply(deps, actorOf(first!), {
      leadId: first!.leadId,
      channel: 'WHATSAPP',
      body: 'Tenho interesse, me conte mais (teste).',
      classification: 'INTERESTED',
    });
    at('2026-10-13T15:00:00Z');
    const handoff = await handoffToSales(deps, actorOf(first!), {
      leadId: first!.leadId,
      salesOwnerId: sales.id,
      qualification: {
        decisionMaker: 'Sócia fictícia (sócia-administradora)',
        interest: 'Quer conhecer a parceria (teste).',
        bestChannelAndTime: 'WhatsApp, pela manhã',
      },
    });
    at('2026-10-14T15:00:00Z');
    await markOpportunityWon(deps, manager, {
      opportunityId: handoff.id,
      conversionType: 'PARTNER',
    });
    // 2º: pediu para sair.
    await registerOptOut(deps, manager, { leadId: second!.leadId });
    // 3º: ligação atendida também conta como contato.
    await db.activity.create({
      data: {
        leadId: third!.leadId,
        userId: third!.assignedToId,
        type: 'CALL',
        direction: 'OUTBOUND',
        outcome: 'CONNECTED',
        occurredAt: new Date('2026-10-14T13:00:00Z'),
      },
    });

    const detail = await getCampaign(deps, manager, { campaignId });
    const funnel = Object.fromEntries(detail.funnel.map((r) => [r.step, r.count]));
    expect(funnel).toEqual({
      selected: 4,
      eligible: 4,
      released: 4,
      contacted: 2,
      delivered: 0,
      replied: 1,
      interested: 1,
      opportunity: 1,
      converted: 1,
      optedOut: 1,
    });
    expect(detail.funnel.find((r) => r.step === 'replied')).toMatchObject({
      base: 'contacted',
      rate: 0.5,
    });
    expect(detail.variants.map((v) => v.label)).toEqual(['A', 'B']);
    expect(detail.variants.reduce((sum, v) => sum + v.contacted, 0)).toBe(2);
    expect(detail.abTest?.replied).toMatchObject([
      { label: 'B', baselineLabel: 'A', verdict: 'INSUFFICIENT_SAMPLE', pValue: null },
    ]);
    expect(detail.bySdr.map((s) => s.released).reduce((a, b) => a + b, 0)).toBe(4);

    // As mensagens da janela ficam marcadas com a campanha.
    const messages = await db.message.findMany({ where: { leadId: first!.leadId } });
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.every((m) => m.campaignId === campaignId)).toBe(true);

    // Recalcular não muda nada (idempotente).
    const again = await getCampaign(deps, manager, { campaignId });
    expect(again.funnel).toEqual(detail.funnel);

    // O SDR vê na ficha a campanha e a abordagem sorteada.
    const forLead = await getLeadCampaigns(deps, actorOf(third!), { leadId: third!.leadId });
    expect(forLead.items).toMatchObject([
      {
        campaign: { id: campaignId, name: 'Sobral — parceria' },
        status: 'RELEASED',
        variantLabel: expect.stringMatching(/^[AB]$/),
        approach: { name: expect.stringMatching(/Parceria|Economia/) },
      },
    ]);
  });
});
