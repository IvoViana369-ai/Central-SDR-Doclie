import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { handoffToSales } from '../opportunities';
import { createTask } from '../tasks';
import {
  authenticateApiKey,
  createApiKey,
  createWebhookEndpoint,
  exportBiDailyMetrics,
  exportBiEvents,
  getTaskCalendar,
  sendTestWebhook,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
const clock = deps.clock as typeof deps.clock & { set(d: Date): void; advance(ms: number): void };
const START = new Date('2026-10-13T12:00:00Z');
const SOBRAL = 2312908;

describe('agenda e exportação para BI (F12-05, F12-06)', () => {
  let admin: UserActor;
  let sdr: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let phone = 5100;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99755-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });

  beforeEach(async () => {
    clock.set(START);
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('reunião: .ics e link do Google Agenda; só reunião e só no escopo', async () => {
    const lead = await createLead(deps, sdr, make('Escritório Fictício Cumaru'));
    const meeting = await createTask(deps, sdr, {
      leadId: lead.id,
      type: 'MEETING',
      title: 'Apresentação do certificado',
      dueAt: '2026-10-15T13:00:00Z',
    });
    const calendar = await getTaskCalendar(deps, sdr, { taskId: meeting.id });
    expect(calendar.filename).toBe(`reuniao-${meeting.id}.ics`);
    const ics = calendar.ics.replace(/\r\n /g, '');
    expect(ics).toContain('SUMMARY:Apresentação do certificado — Escritório Fictício Cumaru');
    expect(ics).toContain('DTSTART:20261015T130000Z');
    expect(ics).toContain(`URL:https://sdr.example.com/leads/${lead.id}`);
    expect(ics).not.toContain('99755');
    expect(new URL(calendar.googleUrl).searchParams.get('dates')).toBe(
      '20261015T130000Z/20261015T133000Z',
    );

    const followUp = await createTask(deps, sdr, {
      leadId: lead.id,
      title: 'Retornar',
      dueAt: '2026-10-15T13:00:00Z',
    });
    await expect(getTaskCalendar(deps, sdr, { taskId: followUp.id })).rejects.toThrow(
      BusinessRuleError,
    );
    const { actor: other } = await createActor('SDR');
    await expect(getTaskCalendar(deps, other, { taskId: meeting.id })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('eventos para o BI: em ordem, depois de 60 s, sem valores mascarados', async () => {
    const created = await createApiKey(deps, admin, { name: 'BI', scopes: ['bi:read'] });
    const bi = await authenticateApiKey(deps, created.key);
    const lead = await createLead(deps, sdr, make('Escritório Fictício Pau-d’arco'));
    await handoffToSales(deps, sdr, {
      leadId: lead.id,
      salesOwnerId: sales.id,
      qualification: {
        decisionMaker: 'Sócio fictício',
        interest: 'Certificado digital',
        bestChannelAndTime: 'Manhã',
        clientCount: 10,
      },
    });
    clock.advance(1_000);
    await registerOptOut(deps, sdr, { leadId: lead.id });
    const endpoint = await createWebhookEndpoint(deps, admin, {
      name: 'CRM',
      url: 'https://crm.example.com/hook',
      events: ['lead.converted'],
    });
    await sendTestWebhook(deps, admin, { endpointId: endpoint.endpoint.id });

    // Ainda dentro dos 60 s: nada sai.
    expect((await exportBiEvents(deps, bi, {})).data).toEqual([]);
    clock.advance(2 * 60_000);
    const page = await exportBiEvents(deps, bi, {});
    expect(page.data.map((e) => e.type)).toEqual(['opportunity.created', 'optout.registered']);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBe(page.data[1]!.id);
    const optOut = page.data[1]!.payload as { suppressions: Record<string, unknown>[] };
    expect(optOut.suppressions.length).toBeGreaterThan(0);
    expect(optOut.suppressions.every((s) => !('valueMasked' in s))).toBe(true);

    expect((await exportBiEvents(deps, bi, { after: page.cursor! })).data).toEqual([]);
    const only = await exportBiEvents(deps, bi, { types: 'optout.registered' as never });
    expect(only.data.map((e) => e.type)).toEqual(['optout.registered']);

    const reader = await authenticateApiKey(
      deps,
      (await createApiKey(deps, admin, { name: 'CRM', scopes: ['leads:read'] })).key,
    );
    await expect(exportBiEvents(deps, reader, {})).rejects.toThrow(ForbiddenError);
  });

  it('indicadores diários: os dias recalculados desde o cursor, cada um inteiro', async () => {
    const created = await createApiKey(deps, admin, { name: 'BI', scopes: ['bi:read'] });
    const bi = await authenticateApiKey(deps, created.key);
    const t1 = new Date('2026-10-13T06:00:00Z');
    const row = (date: string, dimension: 'GLOBAL' | 'SDR', dimensionId: string, at: Date) => ({
      date: new Date(`${date}T00:00:00Z`),
      dimension,
      dimensionId,
      newLeads: 3,
      firstContacts: 2,
      computedAt: at,
    });
    await db.dailyMetric.createMany({
      data: [
        row('2026-10-11', 'GLOBAL', '', t1),
        row('2026-10-11', 'SDR', sdr.id, t1),
        row('2026-10-12', 'GLOBAL', '', t1),
      ],
    });

    const first = await exportBiDailyMetrics(deps, bi, { limit: 1 });
    expect(first.days.map((d) => d.date)).toEqual(['2026-10-11']);
    expect(first.days[0]!.rows).toEqual([
      expect.objectContaining({ dimension: 'GLOBAL', dimensionId: '', newLeads: 3 }),
      expect.objectContaining({ dimension: 'SDR', dimensionId: sdr.id }),
    ]);
    expect(first.hasMore).toBe(true);
    const second = await exportBiDailyMetrics(deps, bi, { cursor: first.cursor! });
    expect(second.days.map((d) => d.date)).toEqual(['2026-10-12']);
    const none = await exportBiDailyMetrics(deps, bi, { cursor: second.cursor! });
    expect(none.days).toEqual([]);
    expect(none.cursor).toBe(second.cursor);

    // O rollup recalcula o dia 11: ele volta, inteiro.
    const t2 = new Date('2026-10-13T07:00:00Z');
    await db.dailyMetric.deleteMany({ where: { date: new Date('2026-10-11T00:00:00Z') } });
    await db.dailyMetric.createMany({ data: [row('2026-10-11', 'GLOBAL', '', t2)] });
    const again = await exportBiDailyMetrics(deps, bi, { cursor: second.cursor! });
    expect(again.days).toEqual([
      expect.objectContaining({ date: '2026-10-11', rows: [expect.objectContaining({})] }),
    ]);
    const sdrOnly = await exportBiDailyMetrics(deps, bi, { dimension: 'SDR' });
    expect(sdrOnly.days.flatMap((d) => d.rows)).toEqual([]);
    await expect(exportBiDailyMetrics(deps, bi, { cursor: 'lixo' })).rejects.toMatchObject({
      issues: [{ path: 'cursor' }],
    });
  });
});
