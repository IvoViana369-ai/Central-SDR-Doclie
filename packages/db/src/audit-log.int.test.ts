import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();

async function insertEntry() {
  return db.auditLog.create({
    data: { actorType: 'SYSTEM', action: 'TEST', entityType: 'test', entityId: '1' },
  });
}

describe('audit_logs (append-only)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('permite inserir', async () => {
    const entry = await insertEntry();
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.auditLog.count()).toBe(1);
  });

  it('bloqueia UPDATE', async () => {
    const entry = await insertEntry();
    await expect(
      db.auditLog.update({ where: { id: entry.id }, data: { action: 'X' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('bloqueia DELETE sem purga autorizada', async () => {
    const entry = await insertEntry();
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    expect(await db.auditLog.count()).toBe(1);
  });

  it('bloqueia TRUNCATE sem purga autorizada', async () => {
    await insertEntry();
    await expect(db.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
  });

  it('permite DELETE apenas dentro de uma purga autorizada (retenção)', async () => {
    await insertEntry();
    await db.$transaction([
      db.$executeRawUnsafe(`SET LOCAL docline.audit_purge = 'on'`),
      db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE action = 'TEST'`),
    ]);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('a autorização de purga não vaza para fora da transação', async () => {
    await db.$transaction([db.$executeRawUnsafe(`SET LOCAL docline.audit_purge = 'on'`)]);
    await insertEntry();
    await expect(db.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });
});
