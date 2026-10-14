import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  AUTO_ASSIGN_LAST_RUN_KEY,
  createLead,
  getAutoAssignSettings,
  runAutoAssign,
  updateAutoAssignSettings,
  updateUserAvailability,
  type CreateLeadInput,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça, 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const FORTALEZA = 2304400;
const RECIFE = 2611606;
const SETTINGS = {
  enabled: true,
  strategy: 'TERRITORY' as const,
  fallbackToAll: false,
  defaultCapacity: 300,
  includeExistingPool: false,
};

/**
 * Equipe fictícia: SDR A cobre Sobral; SDR B cobre o Ceará inteiro; SDR C
 * (Sobral) está de férias até amanhã. Os leads entram no pool (sem responsável).
 */
describe('distribuição automática (F11-05)', () => {
  let manager: UserActor;
  let sdrA: UserActor;
  let sdrB: UserActor;
  let sdrC: UserActor;
  let sourceId: string;
  let seq = 0;

  const poolLead = async (municipalityCode: number, score = 50) => {
    seq += 1;
    const input: CreateLeadInput = {
      tradeName: `Escritório Pool ${seq}`,
      municipalityCode,
      origin: { sourceId, collectedAt: '2026-09-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'PHONE', value: `(88) 99816-${3400 + seq}`, isWhatsapp: true }],
      acknowledgeDuplicates: true,
      ownerId: null,
    };
    const { id } = await createLead(deps, manager, input);
    await db.lead.update({ where: { id }, data: { score } });
    return id;
  };
  const ownerOf = async (id: string) =>
    (await db.lead.findUniqueOrThrow({ where: { id }, select: { ownerId: true } })).ownerId;

  beforeAll(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdrA = (await createActor('SDR')).actor as UserActor;
    sdrB = (await createActor('SDR')).actor as UserActor;
    sdrC = (await createActor('SDR')).actor as UserActor;
    await db.userTerritory.createMany({
      data: [
        { userId: sdrA.id, stateUf: 'CE', municipalityCode: SOBRAL },
        { userId: sdrB.id, stateUf: 'CE', municipalityCode: null },
        { userId: sdrC.id, stateUf: 'CE', municipalityCode: SOBRAL },
      ],
    });
  });
  beforeEach(() => at('2026-10-13T12:00:00Z'));
  afterAll(() => closeTestDb());

  it('desligada por padrão: o job não faz nada', async () => {
    const lead = await poolLead(SOBRAL);
    expect(await runAutoAssign(deps)).toMatchObject({ enabled: false, assigned: 0 });
    expect(await ownerOf(lead)).toBeNull();
    const view = await getAutoAssignSettings(deps, manager, {});
    expect(view.settings).toMatchObject({ enabled: false, enabledAt: null });
    expect(view.team.map((t) => t.userId).sort()).toEqual([sdrA.id, sdrB.id, sdrC.id].sort());
  });

  it('só a gestão liga; ligar marca o início e pede a distribuição na hora', async () => {
    await expect(updateAutoAssignSettings(deps, sdrA, SETTINGS)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    at('2026-10-13T12:30:00Z');
    const saved = await updateAutoAssignSettings(deps, manager, SETTINGS);
    expect(saved.enabledAt).toBe('2026-10-13T12:30:00.000Z');
    expect(enqueued.at(-1)).toMatchObject({ name: 'leads.auto-assign' });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'leads.auto_assign_update' },
    });
    expect(audit.changes).toMatchObject({ enabled: [false, true] });

    // Ajustar sem desligar mantém o início.
    at('2026-10-13T13:00:00Z');
    const again = await updateAutoAssignSettings(deps, manager, {
      ...SETTINGS,
      defaultCapacity: 200,
    });
    expect(again.enabledAt).toBe('2026-10-13T12:30:00.000Z');
    await updateAutoAssignSettings(deps, manager, SETTINGS);
  });

  it('território: cidade antes da UF; ausente fora; sem cobertura fica no pool', async () => {
    await updateUserAvailability(deps, manager, { userId: sdrC.id, awayUntil: '2026-10-14' });
    at('2026-10-13T14:00:00Z');
    const sobral = await poolLead(SOBRAL, 90);
    const fortaleza = await poolLead(FORTALEZA, 80);
    const recife = await poolLead(RECIFE, 70);
    const optedOut = await poolLead(SOBRAL, 99);
    await db.lead.update({ where: { id: optedOut }, data: { contactStatus: 'OPTED_OUT' } });

    const result = await runAutoAssign(deps);
    expect(result).toMatchObject({ enabled: true, assigned: 2, skipped: { NO_TERRITORY: 1 } });
    expect(await ownerOf(sobral)).toBe(sdrA.id);
    expect(await ownerOf(fortaleza)).toBe(sdrB.id);
    expect(await ownerOf(recife)).toBeNull();
    expect(await ownerOf(optedOut)).toBeNull();
    // O lead de antes de ligar (1º teste) não entra: o pool antigo está fora.
    expect(result.candidates).toBe(3);

    const history = await db.leadAssignment.findFirstOrThrow({ where: { leadId: sobral } });
    expect(history).toMatchObject({
      fromUserId: null,
      toUserId: sdrA.id,
      strategy: 'TERRITORY',
      reason: 'Distribuição automática.',
    });
    expect(
      await db.notification.count({ where: { userId: sdrA.id, type: 'leads.assigned' } }),
    ).toBe(1);
    const lastRun = await db.appSetting.findUniqueOrThrow({
      where: { key: AUTO_ASSIGN_LAST_RUN_KEY },
    });
    expect(lastRun.value).toMatchObject({ assigned: 2, skipped: { NO_TERRITORY: 1 } });
  });

  it('limite de leads ativos: dono da cidade cheio, o lead vai para quem cobre a UF', async () => {
    const active = await db.lead.count({ where: { ownerId: sdrA.id, status: 'ACTIVE' } });
    await updateUserAvailability(deps, manager, { userId: sdrA.id, maxActiveLeads: active });
    at('2026-10-13T15:00:00Z');
    const lead = await poolLead(SOBRAL);
    await runAutoAssign(deps);
    expect(await ownerOf(lead)).toBe(sdrB.id);
    await updateUserAvailability(deps, manager, { userId: sdrA.id, maxActiveLeads: null });
  });

  it('lead reservado por campanha em andamento não é distribuído', async () => {
    at('2026-10-13T15:30:00Z');
    const lead = await poolLead(SOBRAL);
    const campaign = await db.campaign.create({
      data: {
        name: 'Campanha fictícia',
        filterDefinition: {},
        channel: 'WHATSAPP',
        ownerId: manager.id,
        dailyContactLimit: 5,
        status: 'ACTIVE',
      },
    });
    await db.campaignLead.create({
      data: {
        campaignId: campaign.id,
        leadId: lead,
        eligibility: 'ELIGIBLE',
        status: 'PENDING',
        addedAt: clockTime,
        assignedToId: sdrA.id,
      },
    });
    await runAutoAssign(deps);
    expect(await ownerOf(lead)).toBeNull();
  });

  it('rodízio e rodízio geral: alterna entre os disponíveis, incluindo quem não cobre o lead', async () => {
    await updateAutoAssignSettings(deps, manager, {
      ...SETTINGS,
      fallbackToAll: true,
      includeExistingPool: true,
    });
    // Recife (sem cobertura) entra no rodízio geral; o pool antigo agora entra.
    const result = await runAutoAssign(deps);
    expect(result.skipped).toEqual({});
    const recifeLeads = await db.lead.findMany({
      where: { municipalityCode: RECIFE },
      select: { ownerId: true },
    });
    expect(recifeLeads.every((l) => l.ownerId !== null)).toBe(true);

    await updateAutoAssignSettings(deps, manager, { ...SETTINGS, strategy: 'ROUND_ROBIN' });
    at('2026-10-13T17:00:00Z');
    const leads = [await poolLead(FORTALEZA), await poolLead(FORTALEZA)];
    await runAutoAssign(deps);
    const owners = await Promise.all(leads.map(ownerOf));
    // SDR C ainda está de férias; A e B se alternam.
    expect(new Set(owners)).toEqual(new Set([sdrA.id, sdrB.id]));
    const strategies = await db.leadAssignment.findMany({
      where: { leadId: { in: leads } },
      select: { strategy: true },
    });
    expect(strategies.every((s) => s.strategy === 'ROUND_ROBIN')).toBe(true);
  });

  it('disponibilidade: só a gestão muda, com o antes e depois na auditoria', async () => {
    await expect(
      updateUserAvailability(deps, sdrA, { userId: sdrA.id, autoAssign: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const saved = await updateUserAvailability(deps, manager, {
      userId: sdrA.id,
      autoAssign: false,
    });
    expect(saved).toMatchObject({ autoAssign: false, awayUntil: null });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.availability_update', entityId: sdrA.id },
      // O relógio do teste volta no tempo entre os casos: a ordem real é a do id.
      orderBy: { id: 'desc' },
    });
    expect(audit.changes).toEqual({ autoAssign: [true, false] });
    const view = await getAutoAssignSettings(deps, manager, {});
    expect(view.team.find((t) => t.userId === sdrA.id)).toMatchObject({
      availableToday: false,
    });
    expect(view.team.find((t) => t.userId === sdrC.id)).toMatchObject({
      awayUntil: '2026-10-14',
      availableToday: false,
    });
  });
});
