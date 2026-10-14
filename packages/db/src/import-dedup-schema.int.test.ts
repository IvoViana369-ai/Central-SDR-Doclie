import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

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
      isTestData: true,
    },
  });
}

async function createUser() {
  return db.user.create({
    data: { name: 'Gestor Fictício', email: `gestor${Date.now()}@example.com`, role: 'MANAGER' },
  });
}

describe('schema de importação e deduplicação (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('par de duplicados é único e sempre ordenado (a < b)', async () => {
    const [x, y] = [await createLead('Alfa'), await createLead('Beta')];
    const [a, b] = x.id < y.id ? [x, y] : [y, x];
    const pair = {
      score: 0.9,
      confidence: 'HIGH' as const,
      reasons: [],
      detectedBy: 'SCAN' as const,
    };
    await db.duplicateCandidate.create({ data: { leadAId: a.id, leadBId: b.id, ...pair } });
    await expect(
      db.duplicateCandidate.create({ data: { leadAId: a.id, leadBId: b.id, ...pair } }),
    ).rejects.toThrow();
    await expect(
      db.duplicateCandidate.create({ data: { leadAId: b.id, leadBId: a.id, ...pair } }),
    ).rejects.toThrow(/duplicate_candidates_ordered_pair/);
  });

  it('linhas e arquivo temporário do lote saem junto com o lote', async () => {
    const user = await createUser();
    const batch = await db.importBatch.create({
      data: {
        fileName: 'leads-ficticios.csv',
        fileSize: 10,
        fileSha256: 'a'.repeat(64),
        fileType: 'CSV',
        createdById: user.id,
        file: { create: { content: Buffer.from('nome;telefone\n') } },
        rows: { create: [{ rowNumber: 1, raw: ['nome', 'telefone'] }] },
      },
    });
    await expect(
      db.importRow.create({ data: { batchId: batch.id, rowNumber: 1, raw: [] } }),
    ).rejects.toThrow();
    await db.importBatch.delete({ where: { id: batch.id } });
    expect(await db.importRow.count()).toBe(0);
    expect(await db.importFile.count()).toBe(0);
  });

  it('lead mesclado aponta para o sobrevivente, e a timeline pode ser movida', async () => {
    const survivor = await createLead('Sobrevivente');
    const merged = await createLead('Mesclado');
    await db.leadEvent.create({
      data: { leadId: merged.id, type: 'lead.created', actorType: 'SYSTEM' },
    });
    await db.lead.update({
      where: { id: merged.id },
      data: { status: 'MERGED', mergedIntoId: survivor.id },
    });
    await db.leadEvent.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });
    expect(await db.leadEvent.count({ where: { leadId: survivor.id } })).toBe(1);
    expect(
      (await db.lead.findUniqueOrThrow({ where: { id: survivor.id }, include: { absorbed: true } }))
        .absorbed,
    ).toHaveLength(1);
  });
});
