import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { enrollLead } from '../cadence';
import {
  createLead,
  getLead,
  pullLeadsFromPool,
  setUserTerritories,
  type CreateLeadInput,
} from '../leads';
import { recordReply } from '../messaging';
import { listMyNotifications, markNotificationsRead } from '../notifications';
import { createTask, getMyQueue, runForgottenScan, runOverdueScan } from '../tasks';
import {
  acceptOpportunity,
  handoffToSales,
  listOpportunities,
  markOpportunityLost,
  markOpportunityWon,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const QUALIFICATION = {
  decisionMaker: 'Sócia fictícia — contadora responsável',
  interest: 'Quer oferecer certificado digital aos clientes do escritório.',
  bestChannelAndTime: 'WhatsApp, manhãs',
  clientCount: 120,
};

describe('fila, transferência ao Comercial e avisos (M10, M15, F5-11, F5-13)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let phone = 7500;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  const lead = (id: string) =>
    db.lead.findUniqueOrThrow({ where: { id }, include: { stage: true } });

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('Minha Fila: respostas primeiro, depois atrasados, hoje, quentes e novos', async () => {
    const replied = (await createLead(deps, sdr, make('Escritório Pau-Brasil'))).id;
    await recordReply(deps, sdr, { leadId: replied, channel: 'WHATSAPP', body: 'Quanto custa?' });
    const late = (await createLead(deps, sdr, make('Escritório Quaresmeira'))).id;
    await createTask(deps, sdr, { leadId: late, title: 'Ligar', dueAt: '2026-10-12T13:00:00Z' });
    const today = (await createLead(deps, sdr, make('Escritório Romã'))).id;
    await enrollLead(deps, sdr, { leadId: today });
    await db.task.updateMany({
      where: { leadId: today },
      data: { dueAt: new Date('2026-10-13T15:00:00Z') },
    });
    const fresh = (await createLead(deps, sdr, make('Escritório Sapucaia'))).id;

    const queue = await getMyQueue(deps, sdr, {});
    const section = (key: string) => queue.sections.find((s) => s.key === key)!;
    expect(section('REPLIES').items.map((i) => i.lead.id)).toEqual([replied]);
    expect(section('REPLIES').items[0]).toMatchObject({
      task: { type: 'REPLY_NEEDED' },
      overdue: false, // SLA de 2 h a partir da resposta
    });
    expect(section('OVERDUE').items).toEqual([
      expect.objectContaining({ lead: expect.objectContaining({ id: late }), overdue: true }),
    ]);
    expect(section('TODAY_FIRST_CONTACT').items.map((i) => i.lead.id)).toEqual([today]);
    // Cada lead aparece uma vez: os três acima não se repetem em "Novos leads".
    expect(section('NEW_LEADS').items.map((i) => i.lead.id)).toEqual([fresh]);

    // A resposta passou do SLA (2 h): fica em destaque.
    at('2026-10-13T15:00:00Z');
    expect((await getMyQueue(deps, sdr, {})).sections[0]!.items[0]!.overdue).toBe(true);
    await expect(getMyQueue(deps, sdr, { userId: manager.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await getMyQueue(deps, manager, { userId: sdr.id })).userId).toBe(sdr.id);
  });

  it('transferência: checklist, oportunidade, aviso e aceite; o comercial passa a ver o lead', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Tamarindo'));
    await enrollLead(deps, sdr, { leadId: id });
    await expect(
      handoffToSales(deps, sdr, {
        leadId: id,
        salesOwnerId: sales.id,
        qualification: { ...QUALIFICATION, decisionMaker: '' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      handoffToSales(deps, sdr, { leadId: id, salesOwnerId: sdr.id, qualification: QUALIFICATION }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Antes da transferência, o comercial não enxerga o lead.
    await expect(getLead(deps, sales, { leadId: id })).rejects.toBeInstanceOf(NotFoundError);

    const opportunity = await handoffToSales(deps, sdr, {
      leadId: id,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
      productInterest: 'Parceria de revenda',
    });
    expect(opportunity).toMatchObject({
      status: 'OPEN',
      acceptDueAt: new Date('2026-10-14T11:00:00Z'), // 1 dia útil, início da janela
      sdr: { id: sdr.id },
      salesOwner: { id: sales.id },
    });
    expect(await lead(id)).toMatchObject({ stage: { key: 'OPPORTUNITY' } });
    expect(await db.cadenceEnrollment.findFirstOrThrow({ where: { leadId: id } })).toMatchObject({
      status: 'STOPPED',
      stopReason: 'STAGE_CHANGED',
    });
    expect(
      await db.task.findFirstOrThrow({
        where: { leadId: id, status: 'OPEN', type: 'HANDOFF_REVIEW' },
      }),
    ).toMatchObject({ assigneeId: sales.id });
    const inbox = await listMyNotifications(deps, sales, {});
    expect(inbox).toMatchObject({
      unread: 1,
      items: [expect.objectContaining({ type: 'handoff.created' })],
    });
    await expect(getLead(deps, sales, { leadId: id })).resolves.toMatchObject({ id });
    await expect(
      handoffToSales(deps, sdr, {
        leadId: id,
        salesOwnerId: sales.id,
        qualification: QUALIFICATION,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Só o comercial dele (ou gestão) decide.
    const otherSales = (await createActor('SALES')).actor;
    await expect(
      acceptOpportunity(deps, otherSales, { opportunityId: opportunity.id }),
    ).rejects.toBeInstanceOf(NotFoundError); // fora do escopo dele
    await acceptOpportunity(deps, sales, { opportunityId: opportunity.id });
    expect(await db.task.count({ where: { leadId: id, status: 'OPEN' } })).toBe(0);
    expect((await listMyNotifications(deps, sdr, {})).items[0]).toMatchObject({
      type: 'handoff.accepted',
    });

    await markOpportunityWon(deps, sales, {
      opportunityId: opportunity.id,
      conversionType: 'PARTNER',
    });
    expect(await lead(id)).toMatchObject({ stage: { key: 'CONVERTED' } });
    expect(await listOpportunities(deps, sdr, { status: 'WON' })).toEqual([
      expect.objectContaining({ id: opportunity.id, conversionTypeLabel: 'Parceiro' }),
    ]);
    await markNotificationsRead(deps, sales, {});
    expect((await listMyNotifications(deps, sales, {})).unread).toBe(0);
  });

  it('perdida com motivo; aceite atrasado avisa a gestão; tarefas atrasadas avisam uma vez', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Umbu'));
    const opportunity = await handoffToSales(deps, sdr, {
      leadId: id,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });
    at('2026-10-14T14:00:00Z'); // passou do prazo de aceite
    const summary = await runOverdueScan(deps);
    expect(summary).toMatchObject({ lateHandoffs: 1, overdueTasks: 1 });
    expect((await listMyNotifications(deps, manager, {})).items[0]).toMatchObject({
      type: 'handoff.sla',
    });
    expect((await listMyNotifications(deps, sales, {})).items.map((n) => n.type)).toContain(
      'task.overdue',
    );
    // Na próxima hora, nada se repete.
    at('2026-10-14T15:00:00Z');
    expect(await runOverdueScan(deps)).toMatchObject({ lateHandoffs: 0, overdueTasks: 0 });

    const reason = await db.lossReason.findUniqueOrThrow({ where: { key: 'HAS_PROVIDER' } });
    await markOpportunityLost(deps, manager, {
      opportunityId: opportunity.id,
      lossReasonId: reason.id,
    });
    expect(await lead(id)).toMatchObject({
      stage: { key: 'NOT_INTERESTED' },
      lossReasonId: reason.id,
    });
    await expect(
      markOpportunityWon(deps, manager, {
        opportunityId: opportunity.id,
        conversionType: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('esquecidos: aviso diário ao responsável', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Vinhático'));
    expect(await runForgottenScan(deps)).toEqual({ owners: 0, leads: 0 });
    // Atribuído e sem atividade há 12 dias (não é mais "novo").
    const longAgo = new Date('2026-10-01T12:00:00Z');
    await db.lead.update({ where: { id }, data: { lastActivityAt: longAgo, assignedAt: longAgo } });
    expect(await runForgottenScan(deps)).toEqual({ owners: 1, leads: 1 });
    expect(
      (await getMyQueue(deps, sdr, {})).sections.find((s) => s.key === 'FORGOTTEN')!.count,
    ).toBe(1);
  });

  it('puxar do pool: os de maior score do território, sem pegar o de outro SDR', async () => {
    await expect(pullLeadsFromPool(deps, sdr, { count: 2 })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await setUserTerritories(deps, admin, {
      userId: sdr.id,
      territories: [{ stateUf: 'CE', municipalityCode: null }],
    });
    const ids: string[] = [];
    for (const name of ['Xique-xique', 'Ypê', 'Zimbro']) {
      ids.push(
        (await createLead(deps, manager, { ...make(`Escritório ${name}`), ownerId: null })).id,
      );
    }
    await db.lead.update({ where: { id: ids[2]! }, data: { score: 90 } });
    await db.lead.update({ where: { id: ids[0]! }, data: { score: 50 } });
    await db.lead.update({ where: { id: ids[1]! }, data: { score: 10 } });

    const pulled = await pullLeadsFromPool(deps, sdr, { count: 2 });
    expect(pulled.claimed).toEqual([ids[2], ids[0]]);
    expect((await lead(ids[2]!)).ownerId).toBe(sdr.id);
    const other = (await createActor('SDR')).actor as UserActor;
    await setUserTerritories(deps, admin, {
      userId: other.id,
      territories: [{ stateUf: 'CE', municipalityCode: null }],
    });
    expect((await pullLeadsFromPool(deps, other, { count: 5 })).claimed).toEqual([ids[1]]);
  });
});
