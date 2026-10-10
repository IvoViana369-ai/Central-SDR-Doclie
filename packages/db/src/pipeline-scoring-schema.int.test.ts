import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PIPELINE_STAGES, seedSalesConfig } from '../seed/sales-config';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';
import { backfillLeadStages } from './pipeline-backfill';

const db = getTestDb();

async function createLead(name: string) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
  return db.lead.create({
    data: {
      displayName: name,
      nameSearch: name.toLowerCase(),
      nameCore: name.toLowerCase(),
      originSourceId: source.id,
      collectedAt: new Date('2026-10-01T12:00:00Z'),
      createdAt: new Date('2026-10-02T09:00:00Z'),
      isTestData: true,
    },
  });
}

describe('schema de pipeline e score (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('a configuração padrão existe depois do reset e o seed não a duplica', async () => {
    const stages = await db.pipelineStage.findMany({ orderBy: { position: 'asc' } });
    expect(stages.map((s) => s.key)).toEqual(PIPELINE_STAGES.map((s) => s.key));
    expect(stages.filter((s) => s.requiresLossReason).map((s) => s.key)).toEqual([
      'NOT_INTERESTED',
      'DISCARDED',
    ]);
    // O ADMIN renomeou uma etapa: o seed não desfaz.
    await db.pipelineStage.update({ where: { id: stages[0]!.id }, data: { name: 'Entrada' } });
    await seedSalesConfig(db);
    expect(await db.pipelineStage.count()).toBe(17);
    expect(
      await db.pipelineStage.findUniqueOrThrow({ where: { id: stages[0]!.id } }),
    ).toMatchObject({
      name: 'Entrada',
    });
    expect(await db.lossReason.count()).toBe(8);
    expect(await db.scoringModel.count()).toBe(1);
  });

  it('um só pipeline padrão e um só modelo de score ativo', async () => {
    await expect(
      db.pipeline.create({ data: { key: 'OUTRO', name: 'Outro', isDefault: true } }),
    ).rejects.toThrow();
    await expect(
      db.scoringModel.create({ data: { name: 'v2', version: 2, status: 'ACTIVE', bands: [] } }),
    ).rejects.toThrow();
    await db.scoringModel.create({ data: { name: 'v2', version: 2, status: 'DRAFT', bands: [] } });
  });

  it('leads sem etapa entram em "Novo" com uma linha aberta no histórico (idempotente)', async () => {
    const lead = await createLead('Alfa Fictícia');
    expect(await backfillLeadStages(db)).toBe(1);
    expect(await backfillLeadStages(db)).toBe(0);
    const placed = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { stage: true, stageHistory: true },
    });
    expect(placed.stage?.key).toBe('NEW');
    expect(placed.stageEnteredAt).toEqual(lead.createdAt);
    expect(placed.stageHistory).toHaveLength(1);
    expect(placed.stageHistory[0]).toMatchObject({ leftAt: null, automationSource: 'RULE' });
  });

  it('só uma passagem aberta por lead no histórico de etapas', async () => {
    const lead = await createLead('Beta Fictícia');
    await backfillLeadStages(db);
    const stage = await db.pipelineStage.findFirstOrThrow({ where: { key: 'TO_QUALIFY' } });
    await expect(
      db.leadStageHistory.create({
        data: { leadId: lead.id, toStageId: stage.id, enteredAt: new Date() },
      }),
    ).rejects.toThrow();
  });
});
