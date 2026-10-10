import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ForbiddenError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { logOutboundMessage, recordReply } from '../messaging';
import { handoffToSales, markOpportunityWon } from '../opportunities';
import { logActivity } from '../tasks';
import {
  ANALYTICS_ROLLUP_KEY,
  exportPerformanceReport,
  getChannelReport,
  getConversionReport,
  getMonthlyEvolution,
  getSdrPerformance,
  requestAnalyticsRollup,
  runAnalyticsRollup,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, createActor } = createTestDeps();
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
 * Cenário fictício (fuso de Fortaleza):
 * - L1 (SDR A): cadastro 02/10; WhatsApp 03/10 (abordagem "Parceria"); interesse
 *   04/10; transferência 06/10; ganho (parceiro) 08/10.
 * - L2 (SDR A): cadastro 01/10 às 23h locais; Instagram 05/10; ligação não atendida 07/10.
 * - L3 (SDR B): cadastro 03/10; Instagram 06/10; objeção 07/10.
 * - L4 (SDR B): cadastro 10/09; WhatsApp 15/09; interesse 02/10 (coorte de setembro).
 * - L5 (SDR A): cadastro 09/10; opt-out 10/10, sem contato.
 */
describe('rollups e relatórios da Fase 11 (F11-01 a F11-03)', () => {
  let manager: UserActor;
  let sdrA: UserActor;
  let sdrB: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let seq = 0;
  const ids: Record<string, string> = {};

  const make = (name: string): CreateLeadInput => {
    seq += 1;
    return {
      tradeName: name,
      municipalityCode: SOBRAL,
      origin: { sourceId, collectedAt: '2026-09-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [
        { type: 'PHONE', value: `(88) 99814-${3200 + seq}`, isWhatsapp: true },
        { type: 'INSTAGRAM', value: `@escritorio_ficticio_${seq}` },
      ],
      acknowledgeDuplicates: true,
    };
  };
  const newLead = async (owner: UserActor, name: string, createdAt: string) => {
    const { id } = await createLead(deps, owner, make(name));
    await db.lead.update({ where: { id }, data: { createdAt: new Date(createdAt) } });
    return id;
  };
  const sent = (
    actor: UserActor,
    leadId: string,
    channel: 'WHATSAPP' | 'INSTAGRAM',
    sentAt: string,
  ) => logOutboundMessage(deps, actor, { leadId, channel, body: 'Olá!', sentAt });
  const reply = (
    actor: UserActor,
    leadId: string,
    channel: 'WHATSAPP' | 'INSTAGRAM',
    receivedAt: string,
    classification: 'INTERESTED' | 'OBJECTION',
  ) =>
    recordReply(deps, actor, {
      leadId,
      channel,
      body: classification === 'INTERESTED' ? 'Tenho interesse.' : 'Já temos fornecedor.',
      receivedAt,
      classification,
    });
  const metric = (date: string, dimension: 'GLOBAL' | 'SDR' | 'CHANNEL', dimensionId = '') =>
    db.dailyMetric.findUnique({
      where: { date_dimension_dimensionId: { date: new Date(date), dimension, dimensionId } },
    });

  beforeAll(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdrA = (await createActor('SDR')).actor as UserActor;
    sdrB = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
    const approach = await db.approach.create({
      data: { key: 'F11_PARCERIA_INT', name: 'Parceria' },
    });

    ids.l1 = await newLead(sdrA, 'Escritório Embaúba', '2026-10-02T12:00:00Z');
    ids.l2 = await newLead(sdrA, 'Escritório Jatobá', '2026-10-02T02:00:00Z');
    ids.l3 = await newLead(sdrB, 'Escritório Aroeira', '2026-10-03T12:00:00Z');
    ids.l4 = await newLead(sdrB, 'Escritório Carnaúba', '2026-09-10T12:00:00Z');
    ids.l5 = await newLead(sdrA, 'Escritório Oiticica', '2026-10-09T12:00:00Z');

    const first = await sent(sdrA, ids.l1, 'WHATSAPP', '2026-10-03T13:00:00Z');
    await db.message.update({ where: { id: first.id }, data: { approachId: approach.id } });
    await reply(sdrA, ids.l1, 'WHATSAPP', '2026-10-04T13:00:00Z', 'INTERESTED');
    await sent(sdrA, ids.l2, 'INSTAGRAM', '2026-10-05T13:00:00Z');
    await logActivity(deps, sdrA, {
      leadId: ids.l2,
      type: 'CALL',
      outcome: 'NO_ANSWER',
      occurredAt: '2026-10-07T14:00:00Z',
    });
    await sent(sdrB, ids.l3, 'INSTAGRAM', '2026-10-06T13:00:00Z');
    await reply(sdrB, ids.l3, 'INSTAGRAM', '2026-10-07T13:00:00Z', 'OBJECTION');
    await sent(sdrB, ids.l4, 'WHATSAPP', '2026-09-15T13:00:00Z');
    await reply(sdrB, ids.l4, 'WHATSAPP', '2026-10-02T13:00:00Z', 'INTERESTED');

    at('2026-10-06T13:00:00Z');
    const opportunity = await handoffToSales(deps, sdrA, {
      leadId: ids.l1,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });
    at('2026-10-08T13:00:00Z');
    await markOpportunityWon(deps, sales, {
      opportunityId: opportunity.id,
      conversionType: 'PARTNER',
    });
    at('2026-10-10T13:00:00Z');
    await registerOptOut(deps, sdrA, { leadId: ids.l5 });
    at('2026-10-13T12:00:00Z');
  });
  afterAll(() => closeTestDb());

  it('1ª execução: preenche desde o lead mais antigo, por equipe, pessoa e canal', async () => {
    const result = await runAnalyticsRollup(deps);
    expect(result).toMatchObject({ from: '2026-09-10', to: '2026-10-13', days: 34 });
    expect(await db.dailyMetric.count({ where: { dimension: 'GLOBAL' } })).toBe(34);

    // 02/10 às 02:00 UTC ainda é 01/10 em Fortaleza.
    expect(await metric('2026-10-01', 'GLOBAL')).toMatchObject({ newLeads: 1 });
    expect(await metric('2026-10-03', 'GLOBAL')).toMatchObject({
      newLeads: 1,
      firstContacts: 1,
      leadsContacted: 1,
      messagesOut: 1,
    });
    // Resposta de L4: 1ª resposta depois do contato de setembro.
    expect(await metric('2026-10-02', 'GLOBAL')).toMatchObject({
      messagesIn: 1,
      leadsReplied: 1,
      interested: 1,
    });
    expect(await metric('2026-10-06', 'GLOBAL')).toMatchObject({ opportunities: 1 });
    expect(await metric('2026-10-08', 'GLOBAL')).toMatchObject({ conversions: 1 });
    expect(await metric('2026-10-10', 'GLOBAL')).toMatchObject({ optOuts: 1 });
    // Dia sem movimento: linha zerada (o dia foi calculado).
    expect(await metric('2026-10-12', 'GLOBAL')).toMatchObject({ newLeads: 0, messagesOut: 0 });

    // Pessoa: o contato registrado é de quem fez; o opt-out, do responsável.
    expect(await metric('2026-10-07', 'SDR', sdrA.id)).toMatchObject({ contactsLogged: 1 });
    expect(await metric('2026-10-07', 'SDR', sdrB.id)).toMatchObject({
      messagesIn: 1,
      leadsReplied: 1,
    });
    expect(await metric('2026-10-10', 'SDR', sdrA.id)).toMatchObject({ optOuts: 1 });
    expect(await metric('2026-10-06', 'SDR', sdrA.id)).toMatchObject({ opportunities: 1 });

    // Canal: volume pelo canal do evento; oportunidade pelo canal do 1º contato.
    expect(await metric('2026-10-05', 'CHANNEL', 'INSTAGRAM')).toMatchObject({
      messagesOut: 1,
      firstContacts: 1,
    });
    expect(await metric('2026-10-07', 'CHANNEL', 'PHONE')).toMatchObject({ contactsLogged: 1 });
    expect(await metric('2026-10-06', 'CHANNEL', 'WHATSAPP')).toMatchObject({ opportunities: 1 });
    // Opt-out de lead sem contato: entra no total, mas em nenhum canal.
    expect(
      await db.dailyMetric.count({ where: { date: new Date('2026-10-10'), dimension: 'CHANNEL' } }),
    ).toBe(0);

    const status = await db.appSetting.findUniqueOrThrow({ where: { key: ANALYTICS_ROLLUP_KEY } });
    expect(status.value).toMatchObject({ from: '2026-09-10', to: '2026-10-13' });
  });

  it('de hora em hora refaz hoje e ontem; às 03h, a semana; o resultado não muda', async () => {
    const before = await db.dailyMetric.count();
    expect(await runAnalyticsRollup(deps)).toMatchObject({ from: '2026-10-12', days: 2 });
    expect(await db.dailyMetric.count()).toBe(before);
    expect(await metric('2026-10-03', 'GLOBAL')).toMatchObject({ firstContacts: 1 });

    at('2026-10-13T06:10:00Z'); // 03:10 em Fortaleza
    expect(await runAnalyticsRollup(deps)).toMatchObject({ from: '2026-10-07', days: 7 });
    at('2026-10-13T12:00:00Z');

    // Período pedido explicitamente (ex.: depois de importar histórico).
    expect(await runAnalyticsRollup(deps, { from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-02',
      days: 2,
    });
    await expect(
      runAnalyticsRollup(deps, { from: '2026-10-05', to: '2026-10-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.dailyMetric.count()).toBe(before);
  });

  it('conversão por canal, pessoa, abordagem e cidade, com intervalo e amostra insuficiente', async () => {
    const byChannel = await getConversionReport(deps, manager, {
      ...PERIOD,
      dimension: 'channel',
    });
    expect(byChannel.total).toMatchObject({ firstContacts: 3, replied: 2, won: 1, partners: 1 });
    expect(byChannel.total.rates.response).toMatchObject({
      rate: 0.6667,
      smallSample: true,
      comparison: null,
    });
    expect(byChannel.rows.map((r) => [r.label, r.firstContacts, r.replied, r.won])).toEqual([
      ['Instagram', 2, 1, 0],
      ['WhatsApp', 1, 1, 1],
    ]);
    const whatsapp = byChannel.rows.find((r) => r.key === 'WHATSAPP')!;
    expect(whatsapp.rates.conversion).toMatchObject({
      rate: 1,
      smallSample: true,
      comparison: 'INSUFFICIENT',
    });
    expect(whatsapp.rates.conversion.interval).toEqual({ low: 0.2065, high: 1 });
    expect(byChannel.freshness.refreshedAt).not.toBeNull();

    const byPerson = await getConversionReport(deps, manager, {
      ...PERIOD,
      dimension: 'firstContactUser',
    });
    expect(byPerson.rows.map((r) => [r.key, r.firstContacts])).toEqual([
      [sdrA.id, 2],
      [sdrB.id, 1],
    ]);

    const byApproach = await getConversionReport(deps, manager, {
      ...PERIOD,
      dimension: 'approach',
    });
    expect(byApproach.rows.map((r) => [r.label, r.firstContacts])).toEqual([
      ['Sem abordagem registrada', 2],
      ['Parceria', 1],
    ]);

    const byCity = await getConversionReport(deps, manager, { ...PERIOD, dimension: 'city' });
    expect(byCity.rows).toEqual([
      expect.objectContaining({ label: 'Sobral/CE', firstContacts: 3, interested: 1 }),
    ]);

    // Filtro por pessoa: a coorte dos 1ºs contatos que ela fez.
    const onlyB = await getConversionReport(deps, manager, {
      ...PERIOD,
      dimension: 'channel',
      userId: sdrB.id,
    });
    expect(onlyB.scope.person).toMatchObject({ id: sdrB.id });
    expect(onlyB.total).toMatchObject({ firstContacts: 1, replied: 1 });
  });

  it('desempenho por SDR: carteira, o que fez no período e a coorte dos seus 1ºs contatos', async () => {
    const report = await getSdrPerformance(deps, manager, PERIOD);
    expect(report.team.cohort).toMatchObject({ firstContacts: 3, replied: 2, won: 1 });
    expect(report.team.activity).toMatchObject({ messagesOut: 3, contactsLogged: 1, optOuts: 1 });
    const [a, b] = report.rows;
    expect(a).toMatchObject({
      userId: sdrA.id,
      portfolio: 3,
      // Oportunidades e conversões são de quem transferiu (sdr_id), como no dashboard.
      activity: { messagesOut: 2, contactsLogged: 1, opportunities: 1, conversions: 1 },
      cohort: { firstContacts: 2, replied: 1, won: 1 },
    });
    expect(b).toMatchObject({
      userId: sdrB.id,
      portfolio: 2,
      activity: { messagesOut: 1, messagesIn: 2 },
      cohort: { firstContacts: 1, replied: 1, won: 0 },
    });
    expect(a!.rates.response.comparison).toBe('INSUFFICIENT');
    // Comercial não entra na lista: só SDRs ativos e quem tem número no período.
    expect(report.rows.map((r) => r.userId)).toEqual([sdrA.id, sdrB.id]);
  });

  it('evolução mensal: volumes do mês e coorte do 1º contato de cada mês', async () => {
    const report = await getMonthlyEvolution(deps, manager, {
      fromMonth: '2026-09',
      toMonth: '2026-10',
    });
    const [september, october] = report.months;
    expect(september).toMatchObject({
      month: '2026-09',
      label: 'set/2026',
      partial: false,
      activity: { newLeads: 1, firstContacts: 1, messagesOut: 1 },
      // A resposta de outubro conta na coorte de setembro (até hoje).
      cohort: { firstContacts: 1, replied: 1, interested: 1 },
    });
    expect(october).toMatchObject({
      partial: true,
      activity: { newLeads: 4, firstContacts: 3, messagesOut: 3, conversions: 1, optOuts: 1 },
      cohort: { firstContacts: 3, replied: 2, won: 1 },
    });
    expect(report.total.cohort).toMatchObject({ firstContacts: 4, replied: 3 });

    const sdrBMonths = await getMonthlyEvolution(deps, manager, {
      fromMonth: '2026-09',
      toMonth: '2026-10',
      userId: sdrB.id,
    });
    expect(sdrBMonths.months.map((m) => m.cohort.firstContacts)).toEqual([1, 1]);
    expect(sdrBMonths.months[1]!.activity).toMatchObject({ messagesOut: 1, messagesIn: 2 });

    await expect(
      getMonthlyEvolution(deps, manager, { fromMonth: '2026-11', toMonth: '2026-10' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('canais: WhatsApp × Instagram lado a lado, sem veredito com amostra pequena', async () => {
    const report = await getChannelReport(deps, manager, PERIOD);
    expect(report.rows.map((r) => r.channel).slice(0, 2)).toEqual(['WHATSAPP', 'INSTAGRAM']);
    const instagram = report.rows.find((r) => r.channel === 'INSTAGRAM')!;
    expect(instagram).toMatchObject({
      label: 'Instagram',
      activity: { messagesOut: 2, messagesIn: 1, firstContacts: 2 },
      cohort: { firstContacts: 2, replied: 1 },
    });
    expect(report.rows.find((r) => r.channel === 'PHONE')).toMatchObject({
      activity: { contactsLogged: 1 },
      cohort: { firstContacts: 0 },
    });
    expect(report.whatsappVsInstagram.response).toMatchObject({
      label: 'WhatsApp',
      baselineLabel: 'Instagram',
      difference: 0.5,
      verdict: 'INSUFFICIENT_SAMPLE',
    });
  });

  it('exportação auditada e só para quem vê a equipe; recálculo pedido vai para a fila', async () => {
    const file = await exportPerformanceReport(deps, manager, {
      report: 'conversion',
      ...PERIOD,
      dimension: 'channel',
    });
    expect(file.filename).toBe('relatorio-conversion-channel-2026-10-01_2026-10-13.csv');
    const lines = file.csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toContain('Canal do 1º contato;Primeiros contatos (coorte);Responderam');
    expect(lines[1]).toContain('Instagram;2;1;50,0;');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'report.export' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ report: 'conversion', dimension: 'channel', rows: 2 });

    const monthly = await exportPerformanceReport(deps, manager, {
      report: 'monthly',
      fromMonth: '2026-09',
      toMonth: '2026-10',
    });
    expect(monthly.rows).toBe(2);
    expect(
      (await exportPerformanceReport(deps, manager, { report: 'channels', ...PERIOD })).rows,
    ).toBeGreaterThanOrEqual(3);
    expect(
      (await exportPerformanceReport(deps, manager, { report: 'sdrPerformance', ...PERIOD })).rows,
    ).toBe(2);

    for (const call of [
      () => getConversionReport(deps, sdrA, { ...PERIOD, dimension: 'city' }),
      () => getSdrPerformance(deps, sdrA, PERIOD),
      () => exportPerformanceReport(deps, sdrA, { report: 'channels', ...PERIOD }),
      () => requestAnalyticsRollup(deps, sdrA, PERIOD),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }

    const queued = await requestAnalyticsRollup(deps, manager, PERIOD);
    expect(queued).toEqual({ from: '2026-10-01', to: '2026-10-13', queued: true });
    expect(enqueued.at(-1)).toMatchObject({
      name: 'analytics.rollup',
      data: { from: '2026-10-01', to: '2026-10-13' },
    });
  });
});
