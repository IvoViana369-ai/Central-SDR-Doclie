import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();

async function createLead(data: { cnpj?: string; name?: string } = {}) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
  const name = data.name ?? 'Escritório Teste';
  return db.lead.create({
    data: {
      displayName: name,
      nameSearch: name.toLowerCase(),
      nameCore: name.toLowerCase(),
      originSourceId: source.id,
      collectedAt: new Date('2026-10-01T12:00:00Z'),
      cnpj: data.cnpj ?? null,
      isTestData: true,
    },
  });
}

describe('schema de leads e conformidade (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('gera código sequencial legível', async () => {
    const a = await createLead();
    const b = await createLead();
    expect(b.code).toBe(a.code + 1);
  });

  it('um único lead ativo por CNPJ (mesclados não contam)', async () => {
    const first = await createLead({ cnpj: '11222333000181' });
    await expect(createLead({ cnpj: '11222333000181' })).rejects.toThrow();
    await db.lead.update({ where: { id: first.id }, data: { status: 'MERGED' } });
    await expect(createLead({ cnpj: '11222333000181' })).resolves.toBeDefined();
  });

  it('um só ponto de contato principal ativo por tipo e por lead', async () => {
    const lead = await createLead();
    const base = { leadId: lead.id, type: 'PHONE' as const, valueHash: 'h', isPrimary: true };
    await db.contactPoint.create({
      data: { ...base, valueRaw: '1', valueNormalized: '+5588999999991' },
    });
    await expect(
      db.contactPoint.create({
        data: { ...base, valueRaw: '2', valueNormalized: '+5588999999992' },
      }),
    ).rejects.toThrow();
    // O mesmo valor não se repete no lead.
    await expect(
      db.contactPoint.create({
        data: { ...base, isPrimary: false, valueRaw: '1', valueNormalized: '+5588999999991' },
      }),
    ).rejects.toThrow();
  });

  describe('timeline append-only', () => {
    it('bloqueia alteração e exclusão de eventos', async () => {
      const lead = await createLead();
      const event = await db.leadEvent.create({
        data: { leadId: lead.id, type: 'lead.created', actorType: 'SYSTEM' },
      });
      await expect(
        db.leadEvent.update({ where: { id: event.id }, data: { type: 'lead.updated' } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.leadEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    });

    it('permite mover o evento para outro lead (mesclagem)', async () => {
      const [a, b] = [await createLead(), await createLead()];
      const event = await db.leadEvent.create({
        data: { leadId: a.id, type: 'lead.created', actorType: 'SYSTEM' },
      });
      await db.leadEvent.update({ where: { id: event.id }, data: { leadId: b.id } });
      expect((await db.leadEvent.findUniqueOrThrow({ where: { id: event.id } })).leadId).toBe(b.id);
    });
  });

  describe('Lista Não Contatar', () => {
    const entry = {
      type: 'PHONE' as const,
      valueHash: 'hash-do-telefone',
      valueMasked: '+55 88 9****-9999',
      reason: 'OPT_OUT' as const,
      source: 'SDR' as const,
    };

    it('uma supressão vigente por identificador e escopo; após revogada, pode voltar', async () => {
      const first = await db.suppressionEntry.create({ data: entry });
      await expect(db.suppressionEntry.create({ data: entry })).rejects.toThrow();
      await db.suppressionEntry.update({
        where: { id: first.id },
        data: { revokedAt: new Date(), revokeReason: 'Titular pediu para voltar' },
      });
      await expect(db.suppressionEntry.create({ data: entry })).resolves.toBeDefined();
    });

    it('registro não pode ser alterado, só revogado uma vez, e não pode ser apagado', async () => {
      const created = await db.suppressionEntry.create({ data: entry });
      await expect(
        db.suppressionEntry.update({ where: { id: created.id }, data: { reason: 'LEGAL' } }),
      ).rejects.toThrow(/só a revogação/);
      await expect(db.suppressionEntry.delete({ where: { id: created.id } })).rejects.toThrow(
        /rotina de retenção/,
      );
      await db.suppressionEntry.update({
        where: { id: created.id },
        data: { revokedAt: new Date(), revokeReason: 'motivo' },
      });
      await expect(
        db.suppressionEntry.update({
          where: { id: created.id },
          data: { revokeReason: 'outro motivo' },
        }),
      ).rejects.toThrow(/já registrada/);
    });

    it('sobrevive à exclusão do lead (o vínculo vira nulo e o hash continua)', async () => {
      const lead = await createLead();
      const created = await db.suppressionEntry.create({ data: { ...entry, leadId: lead.id } });
      await db.$transaction([
        db.$executeRawUnsafe(`SET LOCAL docline.audit_purge = 'on'`),
        db.lead.delete({ where: { id: lead.id } }),
      ]);
      const after = await db.suppressionEntry.findUniqueOrThrow({ where: { id: created.id } });
      expect(after).toMatchObject({ leadId: null, valueHash: entry.valueHash, revokedAt: null });
    });
  });
});
