/**
 * Gera seed/data/states.json e seed/data/municipalities.json.
 *
 * Fonte: dataset "municipios-brasileiros" (Kelvin S. do Prado, licença MIT),
 * derivado da base de localidades do IBGE, com DDD e fuso horário por município.
 * A API oficial do IBGE (servicodados.ibge.gov.br) é a referência para conferência.
 *
 * Uso:
 *   pnpm --filter @docline/db exec tsx scripts/build-reference-data.ts
 *   pnpm --filter @docline/db exec tsx scripts/build-reference-data.ts <estados.csv> <municipios.csv>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://github.com/kelvins/municipios-brasileiros';
const RAW = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv';

/** Fuso horário oficial de cada UF (capital). O Brasil não adota horário de verão desde 2019. */
const STATE_TIMEZONES: Record<string, string> = {
  RO: 'America/Porto_Velho',
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  RR: 'America/Boa_Vista',
  PA: 'America/Belem',
  AP: 'America/Belem',
  TO: 'America/Araguaina',
  MA: 'America/Fortaleza',
  PI: 'America/Fortaleza',
  CE: 'America/Fortaleza',
  RN: 'America/Fortaleza',
  PB: 'America/Fortaleza',
  PE: 'America/Recife',
  AL: 'America/Maceio',
  SE: 'America/Maceio',
  BA: 'America/Bahia',
  MG: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  RJ: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  PR: 'America/Sao_Paulo',
  SC: 'America/Sao_Paulo',
  RS: 'America/Sao_Paulo',
  MS: 'America/Campo_Grande',
  MT: 'America/Cuiaba',
  GO: 'America/Sao_Paulo',
  DF: 'America/Sao_Paulo',
};

/** Deslocamento UTC atual de um fuso (ex.: "GMT-3"). */
function utcOffset(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date('2026-01-15T12:00:00Z'));
  return parts.find((p) => p.type === 'timeZoneName')!.value;
}

async function load(arg: string | undefined, file: string): Promise<string> {
  if (arg) return readFileSync(arg, 'utf8');
  const res = await fetch(`${RAW}/${file}`);
  if (!res.ok) throw new Error(`Falha ao baixar ${file}: HTTP ${res.status}`);
  return res.text();
}

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...lines] = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  const columns = header!.split(',');
  return lines.map((line) => {
    const values = line.split(',');
    if (values.length !== columns.length) throw new Error(`Linha inesperada: ${line}`);
    return Object.fromEntries(columns.map((c, i) => [c, values[i]!]));
  });
}

async function main() {
  const [statesArg, municipalitiesArg] = process.argv.slice(2);
  const statesCsv = parseCsv(await load(statesArg, 'estados.csv'));
  const municipalitiesCsv = parseCsv(await load(municipalitiesArg, 'municipios.csv'));

  const ufByCode = new Map<string, string>();
  const states = statesCsv
    .map((s) => {
      const uf = s.uf!;
      const timezone = STATE_TIMEZONES[uf];
      if (!timezone) throw new Error(`UF sem fuso configurado: ${uf}`);
      ufByCode.set(s.codigo_uf!, uf);
      return { uf, name: s.nome!, ibgeCode: Number(s.codigo_uf), region: s.regiao!, timezone };
    })
    .sort((a, b) => a.uf.localeCompare(b.uf));

  const rows = municipalitiesCsv
    .map((m) => {
      const uf = ufByCode.get(m.codigo_uf!);
      if (!uf) throw new Error(`Município com UF desconhecida: ${m.codigo_ibge}`);
      // O dataset usa fusos genéricos por deslocamento (ex.: America/Sao_Paulo para
      // UTC-3). Quando o deslocamento coincide com o da UF, adotamos o fuso da UF;
      // fusos realmente diferentes (oeste do AM em UTC-5, Noronha) são mantidos.
      const stateTz = STATE_TIMEZONES[uf]!;
      const timezone =
        utcOffset(m.fuso_horario!) === utcOffset(stateTz) ? stateTz : m.fuso_horario!;
      return [
        Number(m.codigo_ibge),
        m.nome!,
        uf,
        m.ddd ? Number(m.ddd) : null,
        timezone,
        m.capital === '1',
        Number(m.latitude),
        Number(m.longitude),
      ] as const;
    })
    .sort((a, b) => a[0] - b[0]);

  const out = (name: string) => fileURLToPath(new URL(`../seed/data/${name}`, import.meta.url));
  writeFileSync(out('states.json'), `${JSON.stringify({ source: SOURCE, states }, null, 2)}\n`);
  const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  writeFileSync(
    out('municipalities.json'),
    `{\n  "source": "${SOURCE}",\n  "columns": ["ibgeCode", "name", "uf", "ddd", "timezone", "isCapital", "latitude", "longitude"],\n  "rows": [\n${body}\n  ]\n}\n`,
  );
  console.log(`${states.length} UFs e ${rows.length} municípios gravados em seed/data/`);
}

await main();
