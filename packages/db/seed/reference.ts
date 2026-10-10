import { readFileSync } from 'node:fs';
import type { DbClient } from '../src/client';
import { newId } from '../src/ids';
import { nationalHolidays } from '../src/reference/holidays';
import { toSearchKey } from '../src/search-key';
import { seedSalesConfig, type SalesConfigSeedResult } from './sales-config';

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
  leadSources: number;
  segments: number;
  salesConfig: SalesConfigSeedResult;
}

/**
 * Origens de leads com a base legal sugerida (docs/LGPD.md §4). A sugestão só
 * preenche o formulário: quem cadastra confirma. Origens cuja base depende da
 * coleta original ficam "não avaliada", o que bloqueia o contato até a revisão.
 */
export const LEAD_SOURCES = [
  { key: 'DOCLINE_CUSTOMERS', name: 'Base Docline (clientes)', defaultLegalBasis: 'CONTRACT' },
  {
    key: 'DOCLINE_LEGACY',
    name: 'Base Docline (ex-clientes e contatos antigos)',
    defaultLegalBasis: 'LEGITIMATE_INTEREST',
  },
  { key: 'REFERRAL', name: 'Indicação', defaultLegalBasis: 'LEGITIMATE_INTEREST' },
  { key: 'THIRD_PARTY_LIST', name: 'Planilha de terceiros', defaultLegalBasis: 'NOT_ASSESSED' },
  { key: 'GOOGLE', name: 'Google', defaultLegalBasis: 'LEGITIMATE_INTEREST' },
  {
    key: 'INSTAGRAM',
    name: 'Instagram (perfil profissional)',
    defaultLegalBasis: 'LEGITIMATE_INTEREST',
  },
  {
    key: 'CNPJ_OPEN_DATA',
    name: 'Dados abertos CNPJ (Receita Federal)',
    defaultLegalBasis: 'LEGITIMATE_INTEREST',
  },
  { key: 'EVENT', name: 'Evento', defaultLegalBasis: 'NOT_ASSESSED' },
  { key: 'INBOUND', name: 'Campanha inbound (formulário, anúncio)', defaultLegalBasis: 'CONSENT' },
  {
    key: 'MANUAL_OTHER',
    name: 'Outra origem (cadastro manual)',
    defaultLegalBasis: 'NOT_ASSESSED',
  },
] as const;

export const SEGMENTS = [
  { key: 'contabilidade', name: 'Contabilidade' },
  { key: 'assessoria_empresarial', name: 'Assessoria empresarial' },
  { key: 'bpo_financeiro', name: 'BPO financeiro' },
  { key: 'advocacia', name: 'Advocacia' },
  { key: 'despachante', name: 'Despachante' },
  { key: 'outro', name: 'Outro' },
] as const;

/**
 * Dados de referência (idempotente; pode rodar em produção a cada deploy):
 * UFs, municípios (IBGE), feriados nacionais, origens, segmentos e a
 * configuração comercial inicial (pipeline, motivos de perda e score).
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

  // Origens e segmentos: só cria o que falta (o ADMIN pode renomear ou desativar).
  await db.$transaction([
    ...LEAD_SOURCES.map((source, position) =>
      db.leadSource.upsert({
        where: { key: source.key },
        create: { ...source, position },
        update: {},
      }),
    ),
    ...SEGMENTS.map((segment) =>
      db.segment.upsert({ where: { key: segment.key }, create: segment, update: {} }),
    ),
  ]);

  const salesConfig = await seedSalesConfig(db);

  return {
    states: states.length,
    municipalities: rows.length,
    holidays: holidays.length,
    leadSources: LEAD_SOURCES.length,
    segments: SEGMENTS.length,
    salesConfig,
  };
}
