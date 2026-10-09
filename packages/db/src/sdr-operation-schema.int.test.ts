import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CADENCE_STEPS, seedSalesConfig } from '../seed/sales-config';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const now = new Date('2026-10-13T12:00:00Z');

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

const defaultCadence = () =>
  db.cadence.findFirstOrThrow({ where: { isDefault: true }, include: { steps: true } });

describe('schema da operação do SDR (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('a cadência padrão existe depois do reset e o seed não a recria nem a desfaz', async () => {
    const cadence = await defaultCadence();
    expect(cadence).toMatchObject({
      name: 'Padrão — Contabilidade',
      stopOnReply: true,
      useBusinessDays: true,
      sendWindowStart: '08:00',
      sendWindowEnd: '18:00',
      noResponseAfterDays: 3,
    });
    expect(
      cadence.steps
        .sort((a, b) => a.position - b.position)
        .map((s) => [s.dayOffset, s.messageType, s.targetStageKey]),
    ).toEqual(DEFAULT_CADENCE_STEPS.map((s) => [s.dayOffset, s.messageType, s.targetStageKey]));

    // O ADMIN mudou o prazo de "Sem resposta": o seed não desfaz.
    await db.cadence.update({ where: { id: cadence.id }, data: { noResponseAfterDays: 5 } });
    expect((await seedSalesConfig(db)).cadenceCreated).toBe(false);
    expect(await db.cadence.count()).toBe(1);
    expect((await defaultCadence()).noResponseAfterDays).toBe(5);
  });

  it('só uma cadência padrão', async () => {
    await expect(
      db.cadence.create({ data: { key: 'OUTRA', name: 'Outra', isDefault: true } }),
    ).rejects.toThrow();
  });

  it('uma inscrição ativa ou pausada por lead; encerrada libera a próxima', async () => {
    const lead = await createLead('Escritório Cadência');
    const cadence = await defaultCadence();
    const enroll = (status: 'ACTIVE' | 'PAUSED' = 'ACTIVE') =>
      db.cadenceEnrollment.create({
        data: {
          leadId: lead.id,
          cadenceId: cadence.id,
          cadenceVersion: 1,
          status,
          enrolledAt: now,
        },
      });
    const first = await enroll();
    await expect(enroll()).rejects.toThrow();
    await db.cadenceEnrollment.update({ where: { id: first.id }, data: { status: 'PAUSED' } });
    await expect(enroll()).rejects.toThrow();
    await db.cadenceEnrollment.update({
      where: { id: first.id },
      data: { status: 'STOPPED', stopReason: 'REPLIED', endedAt: now },
    });
    await expect(enroll()).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('uma tarefa aberta por inscrição (o passo atual)', async () => {
    const lead = await createLead('Escritório Tarefa');
    const cadence = await defaultCadence();
    const enrollment = await db.cadenceEnrollment.create({
      data: { leadId: lead.id, cadenceId: cadence.id, cadenceVersion: 1, enrolledAt: now },
    });
    const task = (status: 'OPEN' | 'DONE' = 'OPEN') =>
      db.task.create({
        data: {
          leadId: lead.id,
          type: 'FOLLOW_UP',
          title: 'Follow-up',
          dueAt: now,
          status,
          enrollmentId: enrollment.id,
        },
      });
    const open = await task();
    await expect(task()).rejects.toThrow();
    await db.task.update({ where: { id: open.id }, data: { status: 'DONE', completedAt: now } });
    await expect(task()).resolves.toMatchObject({ status: 'OPEN' });
    // Tarefas avulsas (sem inscrição) não têm limite.
    await db.task.createMany({
      data: [1, 2].map((n) => ({
        leadId: lead.id,
        type: 'CUSTOM',
        title: `Avulsa ${n}`,
        dueAt: now,
      })),
    });
    expect(await db.task.count({ where: { leadId: lead.id, status: 'OPEN' } })).toBe(3);
  });

  it('uma oportunidade aberta por lead', async () => {
    const lead = await createLead('Escritório Oportunidade');
    const open = () =>
      db.opportunity.create({
        data: { leadId: lead.id, handoffAt: now, acceptDueAt: now, qualification: {} },
      });
    const first = await open();
    await expect(open()).rejects.toThrow();
    await db.opportunity.update({
      where: { id: first.id },
      data: { status: 'WON', wonAt: now, conversionType: 'PARTNER' },
    });
    await expect(open()).resolves.toMatchObject({ status: 'OPEN' });
  });
});
