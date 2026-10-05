import { afterAll, describe, expect, it } from 'vitest';
import { seedReference } from '../../seed/reference';
import { closeTestDb, getTestDb } from '../../test/helpers';

const db = getTestDb();

describe('seedReference', () => {
  afterAll(() => closeTestDb());

  it('carrega UFs, municípios e feriados', async () => {
    const result = await seedReference(db, { holidayYears: { from: 2026, to: 2027 } });
    expect(result.states).toBe(27);
    expect(await db.state.count()).toBe(27);
    expect(await db.municipality.count()).toBe(result.municipalities);
    expect(result.municipalities).toBeGreaterThan(5500);
    expect(await db.holiday.count()).toBe(26);
  });

  it('é idempotente', async () => {
    const before = await db.municipality.count();
    await seedReference(db, { holidayYears: { from: 2026, to: 2027 } });
    expect(await db.municipality.count()).toBe(before);
    expect(await db.holiday.count()).toBe(26);
  });

  it('grava município com DDD, fuso e chave de busca', async () => {
    const sobral = await db.municipality.findUniqueOrThrow({ where: { ibgeCode: 2312908 } });
    expect(sobral).toMatchObject({ name: 'Sobral', uf: 'CE', ddd: 88, nameSearch: 'sobral' });
    expect(sobral.timezone).toBe('America/Fortaleza');
    const ce = await db.state.findUniqueOrThrow({ where: { uf: 'CE' } });
    expect(ce).toMatchObject({ name: 'Ceará', region: 'Nordeste', timezone: 'America/Fortaleza' });
  });

  it('encontra municípios por similaridade (pg_trgm) mesmo com grafia aproximada', async () => {
    const rows = await db.$queryRaw<{ name: string; uf: string }[]>`
      SELECT name, uf FROM municipalities
      WHERE name_search % ${'itapaje'}
      ORDER BY similarity(name_search, ${'itapaje'}) DESC LIMIT 1`;
    expect(rows[0]).toEqual({ name: 'Itapajé', uf: 'CE' });
  });

  it('usa UUIDv7 nos feriados', async () => {
    const holiday = await db.holiday.findFirstOrThrow({ where: { key: 'NATIONAL:2026-12-25' } });
    expect(holiday.id[14]).toBe('7');
    expect(holiday.name).toBe('Natal');
  });
});
