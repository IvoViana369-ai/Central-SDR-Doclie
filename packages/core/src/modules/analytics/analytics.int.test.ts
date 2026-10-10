import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ForbiddenError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { archiveLead, createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { logOutboundMessage, recordReply } from '../messaging';
import { handoffToSales, markOpportunityWon } from '../opportunities';
import { logActivity } from '../tasks';
import {
  exportAnalyticsReport,
  getAnalyticsBreakdown,
  getDashboard,
  getDailySeries,
  getStageFunnel,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça, 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const PERIOD = { from: '2026-10-01', to: '2026-10-13' };
const QUALIFICATION = {
  decisionMaker: 'Sócia fictícia — contadora responsável',
  interest: 'Quer oferecer certificado digital aos clientes do escritório.',
  bestChannelAndTime: 'WhatsApp, manhãs',
  clientCount: 120,
};

/**
 * Cenário fictício (período 01 a 13/10, fuso de Fortaleza):
 * - L1 (SDR A): cadastro 02/10, 1º contato 03/10, resposta com interesse 04/10,
 *   transferência 06/10, ganho (parceiro) 08/10.
 * - L2 (SDR A): cadastro 01/10 às 23h locais, 1º contato 05/10, ligação 07/10, sem resposta.
 * - L3 (SDR B): cadastro 03/10, 1º contato 06/10, objeção 07/10.
 * - L4 (SDR B): cadastro e 1º contato em setembro; interesse em 02/10 (fora da coorte).
 * - L5 (SDR A): cadastro 09/10, opt-out 10/10.
 * - L6 (SDR A): cadastro 04/10, arquivado.
 */
describe('dashboard e relatórios (M16, F6-08, F6-09)', () => {
  let manager: UserActor;
  let sdrA: UserActor;
  let sdrB: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let phone = 3100;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-09-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99813-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  const newLead = async (owner: UserActor, name: string, createdAt: string) => {
    const { id } = await createLead(deps, owner, make(name));
    await db.lead.update({ where: { id }, data: { createdAt: new Date(createdAt) } });
    return id;
  };
  const sent = (actor: UserActor, leadId: string, sentAt: string) =>
    logOutboundMessage(deps, actor, { leadId, channel: 'WHATSAPP', body: 'Olá!', sentAt });
  const reply = (
    actor: UserActor,
    leadId: string,
    receivedAt: string,
    classification: 'INTERESTED' | 'OBJECTION',
  ) =>
    recordReply(deps, actor, {
      leadId,
      channel: 'WHATSAPP',
      body: classification === 'INTERESTED' ? 'Tenho interesse.' : 'Já temos fornecedor.',
      receivedAt,
      classification,
    });

  beforeAll(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdrA = (await createActor('SDR')).actor as UserActor;
    sdrB = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;

    at('2026-10-13T12:00:00Z');
    const l1 = await newLead(sdrA, 'Escritório Embaúba', '2026-10-02T12:00:00Z');
    const l2 = await newLead(sdrA, 'Escritório Jatobá', '2026-10-02T02:00:00Z');
    const l3 = await newLead(sdrB, 'Escritório Aroeira', '2026-10-03T12:00:00Z');
    const l4 = await newLead(sdrB, 'Escritório Carnaúba', '2026-09-10T12:00:00Z');
    const l5 = await newLead(sdrA, 'Escritório Oiticica', '2026-10-09T12:00:00Z');
    const l6 = await newLead(sdrA, 'Escritório Mandacaru', '2026-10-04T12:00:00Z');

    await sent(sdrA, l1, '2026-10-03T13:00:00Z');
    await reply(sdrA, l1, '2026-10-04T13:00:00Z', 'INTERESTED');
    await sent(sdrA, l2, '2026-10-05T13:00:00Z');
    await logActivity(deps, sdrA, {
      leadId: l2,
      type: 'CALL',
      outcome: 'NO_ANSWER',
      occurredAt: '2026-10-07T14:00:00Z',
    });
    await sent(sdrB, l3, '2026-10-06T13:00:00Z');
    await reply(sdrB, l3, '2026-10-07T13:00:00Z', 'OBJECTION');
    await sent(sdrB, l4, '2026-09-15T13:00:00Z');
    await reply(sdrB, l4, '2026-10-02T13:00:00Z', 'INTERESTED');

    at('2026-10-06T13:00:00Z');
    const opportunity = await handoffToSales(deps, sdrA, {
      leadId: l1,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });
    at('2026-10-08T13:00:00Z');
    await markOpportunityWon(deps, sales, {
      opportunityId: opportunity.id,
      conversionType: 'PARTNER',
    });
    at('2026-10-10T13:00:00Z');
    await registerOptOut(deps, sdrA, { leadId: l5 });
    await archiveLead(deps, sdrA, { leadId: l6 });
    at('2026-10-13T12:00:00Z');
  });
  afterAll(() => closeTestDb());

  it('indicadores da equipe com período, coorte e retrato', async () => {
    const data = await getDashboard(deps, manager, PERIOD);
    expect(data.scope).toMatchObject({ canSeeTeam: true, person: null, days: 13 });
    expect(data.kpis).toEqual({
      totalLeads: 5,
      newLeads: 5,
      contacted: 3,
      messagesSent: 3,
      contactsLogged: 1,
      firstContacts: 3,
      responded: 2,
      responseRate: 0.6667,
      interested: 2,
      opportunities: 1,
      conversions: 1,
      partners: 1,
      customers: 0,
      conversionRate: 0.3333,
      optOuts: 1,
      medianHoursToFirstContact: 73,
      smallSample: true,
    });
    expect(data.cohort).toEqual({
      firstContacts: 3,
      responded: 2,
      interested: 1,
      opportunities: 1,
      won: 1,
    });
    expect(data.cities).toEqual([
      expect.objectContaining({ label: 'Sobral/CE', newLeads: 5, active: 5, firstContacts: 3 }),
    ]);
    expect(data.sources).toEqual([expect.objectContaining({ label: 'Evento', responded: 2 })]);
    expect(data.sdrs?.map((r) => [r.key, r.firstContacts, r.activity])).toEqual([
      [
        sdrA.id,
        2,
        { leadsContacted: 2, messagesSent: 2, contactsLogged: 1, opportunities: 1, conversions: 1 },
      ],
      [
        sdrB.id,
        1,
        { leadsContacted: 1, messagesSent: 1, contactsLogged: 0, opportunities: 0, conversions: 0 },
      ],
    ]);
  });

  it('evolução diária no fuso local e funil por etapa', async () => {
    const { days } = await getDailySeries(deps, manager, PERIOD);
    const day = (d: string) => days.find((x) => x.day === d)!;
    expect(days).toHaveLength(13);
    // 02/10 às 02:00 UTC ainda é 01/10 em Fortaleza.
    expect(day('2026-10-01').newLeads).toBe(1);
    expect(day('2026-10-02')).toMatchObject({ newLeads: 1, replies: 1 });
    expect(day('2026-10-03')).toMatchObject({ firstContacts: 1, leadsContacted: 1 });
    expect(day('2026-10-06')).toMatchObject({ opportunities: 1, firstContacts: 1 });
    expect(day('2026-10-07')).toMatchObject({ leadsContacted: 1, replies: 1 });
    expect(day('2026-10-08').conversions).toBe(1);

    const { stages } = await getStageFunnel(deps, manager, PERIOD);
    expect(stages.reduce((sum, s) => sum + s.leads, 0)).toBe(5);
    expect(stages.find((s) => s.name === 'Convertido')).toMatchObject({ leads: 1, share: 0.2 });
  });

  it('SDR vê só os próprios números; gestor filtra por pessoa', async () => {
    const mine = await getDashboard(deps, sdrA, { ...PERIOD, userId: sdrB.id });
    expect(mine.scope).toMatchObject({ canSeeTeam: false, person: { id: sdrA.id } });
    expect(mine.sdrs).toBeNull();
    expect(mine.kpis).toMatchObject({
      totalLeads: 3,
      newLeads: 4,
      contacted: 2,
      firstContacts: 2,
      responded: 1,
      interested: 1,
      opportunities: 1,
      conversions: 1,
      optOuts: 1,
    });

    const theirs = await getDashboard(deps, manager, { ...PERIOD, userId: sdrB.id });
    expect(theirs.scope.person).toMatchObject({ id: sdrB.id });
    expect(theirs.kpis).toMatchObject({
      totalLeads: 2,
      newLeads: 1,
      contacted: 1,
      firstContacts: 1,
      responded: 1,
      interested: 1,
      opportunities: 0,
      optOuts: 0,
    });
  });

  it('exportação CSV só para quem vê a equipe, auditada', async () => {
    const file = await exportAnalyticsReport(deps, manager, { ...PERIOD, report: 'sdr' });
    expect(file.filename).toBe('relatorio-sdr-2026-10-01_2026-10-13.csv');
    const lines = file.csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toContain('Responsável;Leads ativos;Novos no período');
    expect(lines).toHaveLength(3);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'report.export' } });
    expect(audit).toMatchObject({
      actorId: manager.id,
      metadata: { report: 'sdr', from: PERIOD.from, to: PERIOD.to, rows: 2 },
    });

    const overview = await exportAnalyticsReport(deps, manager, { ...PERIOD, report: 'overview' });
    expect(overview.csv).toContain('Taxa de resposta (%);66,7');
    const daily = await exportAnalyticsReport(deps, manager, { ...PERIOD, report: 'daily' });
    expect(daily.rows).toBe(13);

    await expect(
      exportAnalyticsReport(deps, sdrA, { ...PERIOD, report: 'city' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('período inválido ou longo demais é recusado; quebra por dimensão com limite', async () => {
    await expect(
      getDashboard(deps, manager, { from: '2026-10-13', to: '2026-10-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getDashboard(deps, manager, { from: '2025-01-01', to: '2026-10-13' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const sdrs = await getAnalyticsBreakdown(deps, manager, {
      ...PERIOD,
      dimension: 'sdr',
      limit: 1,
    });
    expect(sdrs.rows.map((r) => r.key)).toEqual([sdrA.id]);
  });

  it('contato registrado com data anterior ao cadastro conta como zero na mediana', async () => {
    // L3 levou 73 h; L7 foi cadastrado depois do contato registrado (−24 h → 0 h).
    const l7 = await newLead(sdrB, 'Escritório Umbuzeiro', '2026-10-12T12:00:00Z');
    await sent(sdrB, l7, '2026-10-11T12:00:00Z');
    const data = await getDashboard(deps, manager, { ...PERIOD, userId: sdrB.id });
    expect(data.kpis).toMatchObject({ firstContacts: 2, medianHoursToFirstContact: 36.5 });
  });
});
