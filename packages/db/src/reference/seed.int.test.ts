import { afterAll, describe, expect, it } from 'vitest';
import { seedReference } from '../../seed/reference';
import { closeTestDb, getTestDb } from '../../test/helpers';

const db = getTestDb();

describe('seedReference', () => {
  afterAll(() => closeTestDb());

  // A preparação dos testes já carregou a referência; aqui confirmamos o conteúdo e a idempotência.
  const holidaysIn2026and2027 = () =>
    db.holiday.count({
      where: { date: { gte: new Date('2026-01-01'), lt: new Date('2028-01-01') } },
    });

  it('carrega UFs, municípios, feriados, origens e segmentos', async () => {
    const result = await seedReference(db, { holidayYears: { from: 2026, to: 2027 } });
    expect(result.states).toBe(27);
    expect(await db.state.count()).toBe(27);
    expect(await db.municipality.count()).toBe(result.municipalities);
    expect(result.municipalities).toBeGreaterThan(5500);
    expect(await holidaysIn2026and2027()).toBe(26);
    expect(await db.leadSource.count()).toBe(result.leadSources);
    expect(await db.segment.count()).toBe(result.segments);
  });

  it('é idempotente e não sobrescreve origens editadas pelo ADMIN', async () => {
    const before = await db.municipality.count();
    await db.leadSource.update({ where: { key: 'GOOGLE' }, data: { name: 'Google Maps' } });
    await seedReference(db, { holidayYears: { from: 2026, to: 2027 } });
    expect(await db.municipality.count()).toBe(before);
    expect(await holidaysIn2026and2027()).toBe(26);
    const google = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
    expect(google).toMatchObject({ name: 'Google Maps', defaultLegalBasis: 'LEGITIMATE_INTEREST' });
    await db.leadSource.update({ where: { key: 'GOOGLE' }, data: { name: 'Google' } });
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
