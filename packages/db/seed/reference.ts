import { readFileSync } from 'node:fs';
import type { DbClient } from '../src/client';
import { newId } from '../src/ids';
import { nationalHolidays } from '../src/reference/holidays';
import { toSearchKey } from '../src/search-key';

interface StatesFile {
  states: { uf: string; name: string; ibgeCode: number; region: string; timezone: string }[];
}
type MunicipalityRow = [number, string, string, number | null, string, boolean, number, number];
interface MunicipalitiesFile {
  rows: MunicipalityRow[];
}

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8')) as T;

export interface ReferenceSeedResult {
  states: number;
  municipalities: number;
  holidays: number;
}

/**
 * Dados de referência (idempotente; pode rodar em produção a cada deploy):
 * UFs, municípios (IBGE) e feriados nacionais.
 */
export async function seedReference(
  db: DbClient,
  options: { holidayYears?: { from: number; to: number } } = {},
): Promise<ReferenceSeedResult> {
  const { states } = readJson<StatesFile>('states.json');
  const { rows } = readJson<MunicipalitiesFile>('municipalities.json');
  const thisYear = new Date().getUTCFullYear();
  const years = options.holidayYears ?? { from: thisYear - 1, to: thisYear + 5 };

  await db.$transaction(
    states.map((s) =>
      db.state.upsert({
        where: { uf: s.uf },
        create: s,
        update: { name: s.name, ibgeCode: s.ibgeCode, region: s.region, timezone: s.timezone },
      }),
    ),
  );

  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db.$executeRawUnsafe(
      `INSERT INTO municipalities (ibge_code, name, name_search, uf, ddd, timezone, is_capital, latitude, longitude)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::char(2)[], $5::int[], $6::text[], $7::bool[], $8::numeric[], $9::numeric[])
       ON CONFLICT (ibge_code) DO UPDATE SET
         name = EXCLUDED.name, name_search = EXCLUDED.name_search, uf = EXCLUDED.uf, ddd = EXCLUDED.ddd,
         timezone = EXCLUDED.timezone, is_capital = EXCLUDED.is_capital,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
      chunk.map((r) => r[0]),
      chunk.map((r) => r[1]),
      chunk.map((r) => toSearchKey(r[1])),
      chunk.map((r) => r[2]),
      chunk.map((r) => r[3]),
      chunk.map((r) => r[4]),
      chunk.map((r) => r[5]),
      chunk.map((r) => r[6]),
      chunk.map((r) => r[7]),
    );
  }

  const holidays = [];
  for (let year = years.from; year <= years.to; year++) holidays.push(...nationalHolidays(year));
  await db.$executeRawUnsafe(
    `INSERT INTO holidays (id, key, date, scope, name, is_optional)
     SELECT i, k, d::date, 'NATIONAL'::holiday_scope, n, o
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::bool[]) AS t(i, k, d, n, o)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_optional = EXCLUDED.is_optional`,
    holidays.map(() => newId()),
    holidays.map((h) => h.key),
    holidays.map((h) => h.date),
    holidays.map((h) => h.name),
    holidays.map((h) => h.isOptional),
  );

  return { states: states.length, municipalities: rows.length, holidays: holidays.length };
}
