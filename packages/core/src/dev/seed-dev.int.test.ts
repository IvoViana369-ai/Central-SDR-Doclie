import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDeps } from '../testing/test-deps';
import { seedDevLeads, type SeedDevResult } from './seed-dev';

const { db, deps, createActor } = createTestDeps();

describe('seed de desenvolvimento', () => {
  let result: SeedDevResult;

  beforeAll(async () => {
    await resetTestData(db);
    await createActor('SDR');
    result = await seedDevLeads(deps, { count: 120, seed: 3 });
  }, 120_000);

  afterAll(() => closeTestDb());

  it('cadastra pelos casos de uso, marcando tudo como dado de teste', async () => {
    expect(result).toMatchObject({ skipped: false, created: 120 });
    expect(await db.lead.count({ where: { isTestData: true } })).toBe(120);
    expect(await db.lead.count({ where: { isTestData: false } })).toBe(0);
    expect(await db.leadEvent.count({ where: { type: 'lead.created' } })).toBe(120);
    expect(await db.auditLog.count({ where: { action: 'lead.create' } })).toBe(120);
  });

  it('inclui duplicados, opt-outs na Lista Não Contatar, arquivados e leads distribuídos', async () => {
    expect(result.duplicates).toBeGreaterThan(0);
    expect(await db.suppressionEntry.count()).toBeGreaterThanOrEqual(result.optedOut);
    expect(await db.lead.count({ where: { status: 'ARCHIVED' } })).toBe(result.archived);
    expect(await db.lead.count({ where: { ownerId: { not: null } } })).toBeGreaterThan(0);
    expect(await db.tag.count()).toBe(4);
  });

  it('não roda de novo se a base fictícia já existe', async () => {
    expect(await seedDevLeads(deps, { count: 10, seed: 3 })).toMatchObject({ skipped: true });
    expect(await db.lead.count()).toBe(120);
  });
});
