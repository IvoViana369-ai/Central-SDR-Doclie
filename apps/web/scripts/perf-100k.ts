/**
 * Teste de desempenho com 100 mil leads fictícios (F6-10; docs/ARCHITECTURE.md §13).
 *
 *   pnpm perf:100k [--leads 100000] [--runs 5] [--skip-seed]
 *
 * Usa um banco só dele (DATABASE_URL_PERF, nome terminado em "_perf"), que é
 * APAGADO e recriado: migrações, dados de referência e a carga fictícia em SQL
 * (leads, contatos, origens, mensagens, ligações, tarefas, oportunidades e
 * opt-outs). Depois mede as leituras pelas mesmas funções da aplicação e
 * imprime a tabela com mínimo, mediana e máximo de cada uma.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  countLeads,
  createIdentifierHasher,
  FakeAiProvider,
  getAiUsage,
  getAnalyticsBreakdown,
  getDashboard,
  getLead,
  getMyQueue,
  getPipelineBoard,
  searchLeads,
  systemClock,
  exportAnalyticsReport,
  type Actor,
  type CoreDeps,
} from '@docline/core';
import { createDbClient } from '@docline/db';
import { createLogger } from '@docline/integrations';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { values } = parseArgs({
  options: {
    leads: { type: 'string', default: '100000' },
    runs: { type: 'string', default: '5' },
    'skip-seed': { type: 'boolean', default: false },
  },
});
const LEADS = Number(values.leads);
const RUNS = Math.max(1, Number(values.runs));

const url =
  process.env.DATABASE_URL_PERF ?? 'postgresql://docline:docline@localhost:5432/docline_sdr_perf';
const dbName = new URL(url).pathname.slice(1);
// Entra em DROP/CREATE DATABASE: só minúsculas, dígitos e "_", terminando em "_perf".
if (!/^[a-z0-9_]+_perf$/.test(dbName)) {
  console.error(
    `Recusado: use um banco só de minúsculas, dígitos e "_", terminado em "_perf" (${dbName}).`,
  );
  process.exit(2);
}

const elapsed = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;

async function recreateDatabase() {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = createDbClient(admin.toString(), { maxConnections: 1 });
  // Nome conferido acima (padrão fechado, terminado em "_perf").
  await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await client.$disconnect();
  const env = { ...process.env, DATABASE_URL: url };
  for (const script of ['migrate:deploy', 'seed']) {
    const result = spawnSync('pnpm', ['--filter', '@docline/db', script], {
      env,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`Falhou: ${script}`);
  }
}

/** Carga fictícia em SQL: rápida e sem passar pela aplicação (o que se mede é a leitura). */
const SEED_SQL = (n: number) => `
INSERT INTO users (id, name, email, role, status, updated_at)
SELECT gen_random_uuid(), 'SDR Desempenho ' || i, 'sdr' || i || '@perf.example', 'SDR', 'ACTIVE', now()
FROM generate_series(1, 10) i;
INSERT INTO users (id, name, email, role, status, updated_at) VALUES
  (gen_random_uuid(), 'Gestora Desempenho', 'gestora@perf.example', 'MANAGER', 'ACTIVE', now()),
  (gen_random_uuid(), 'Comercial Desempenho', 'comercial@perf.example', 'SALES', 'ACTIVE', now());

CREATE TEMP TABLE perf_ctx AS SELECT
  (SELECT array_agg(id ORDER BY email) FROM users WHERE role = 'SDR') AS sdrs,
  (SELECT id FROM users WHERE role = 'SALES') AS sales,
  (SELECT array_agg(id ORDER BY position) FROM lead_sources) AS sources,
  (SELECT array_agg(ibge_code ORDER BY ibge_code) FROM municipalities WHERE uf = 'CE') AS cities,
  (SELECT array_agg(s.id ORDER BY s.position) FROM pipeline_stages s
     JOIN pipelines p ON p.id = s.pipeline_id AND p.is_default WHERE s.category = 'OPEN') AS stages,
  (SELECT id FROM pipelines WHERE is_default) AS pipeline_id;

INSERT INTO leads (id, display_name, name_search, name_core, origin_source_id, collected_at,
  created_via, municipality_code, state_uf, owner_id, assigned_at, pipeline_id, stage_id,
  stage_entered_at, status, archived_at, contact_status, has_phone, has_whatsapp, score, score_band,
  first_contact_at, last_contact_at, first_reply_at, last_inbound_at, last_activity_at,
  is_test_data, created_at, updated_at)
SELECT gen_random_uuid(),
  'Escritório Desempenho ' || g, 'escritorio desempenho ' || g, 'desempenho ' || g,
  c.sources[1 + g % cardinality(c.sources)], t.created, 'IMPORT',
  c.cities[1 + (g * 7) % cardinality(c.cities)], 'CE',
  CASE WHEN g % 5 = 0 THEN NULL ELSE c.sdrs[1 + g % cardinality(c.sdrs)] END, t.created,
  c.pipeline_id, c.stages[1 + g % cardinality(c.stages)], t.created,
  CASE WHEN g % 50 = 0 THEN 'ARCHIVED' ELSE 'ACTIVE' END::lead_status,
  CASE WHEN g % 50 = 0 THEN t.created + interval '30 days' END,
  'CONTACTABLE', true, true, (g * 37) % 100,
  (ARRAY['COLD', 'WARM', 'HOT', 'PRIORITY'])[1 + g % 4]::score_band,
  t.contact, t.contact,
  CASE WHEN t.contact IS NOT NULL AND g % 4 = 0 THEN LEAST(t.contact + interval '1 day', now()) END,
  CASE WHEN t.contact IS NOT NULL AND g % 4 = 0 THEN LEAST(t.contact + interval '1 day', now()) END,
  COALESCE(t.contact, t.created), true, t.created, now()
FROM generate_series(1, ${n}) g
CROSS JOIN perf_ctx c
CROSS JOIN LATERAL (
  SELECT now() - (g % 400) * interval '1 day' - (g % 24) * interval '1 hour' AS created
) base
CROSS JOIN LATERAL (
  SELECT base.created,
    CASE WHEN g % 3 <> 0 THEN LEAST(base.created + interval '2 days', now()) END AS contact
) t;

INSERT INTO contact_points (id, lead_id, type, value_raw, value_normalized, value_hash,
  whatsapp_status, is_primary, status, updated_at)
SELECT gen_random_uuid(), l.id, 'PHONE', '(88) 9' || lpad((l.code % 100000000)::text, 8, '0'),
  '+55889' || lpad((l.code % 100000000)::text, 8, '0'), md5('perf-phone-' || l.code),
  'PROBABLE', true, 'ACTIVE', now()
FROM leads l;

INSERT INTO lead_origins (id, lead_id, source_id, collected_at, is_first_touch)
SELECT gen_random_uuid(), l.id, l.origin_source_id, l.collected_at, true FROM leads l;

INSERT INTO messages (id, lead_id, channel, direction, mode, message_type, body, status,
  is_first_contact, sent_by_id, sent_at, created_at, updated_at)
SELECT gen_random_uuid(), l.id, 'WHATSAPP', 'OUTBOUND', 'ASSISTED', 'FIRST_CONTACT',
  'Mensagem fictícia do teste de desempenho.', 'SENT', true, l.owner_id,
  l.first_contact_at, l.first_contact_at, now()
FROM leads l WHERE l.first_contact_at IS NOT NULL;

INSERT INTO messages (id, lead_id, channel, direction, mode, message_type, body, status,
  sent_by_id, sent_at, created_at, updated_at)
SELECT gen_random_uuid(), l.id, 'WHATSAPP', 'OUTBOUND', 'ASSISTED', 'FOLLOW_UP_1',
  'Follow-up fictício do teste de desempenho.', 'SENT', l.owner_id, f.at, f.at, now()
FROM leads l CROSS JOIN LATERAL (SELECT l.first_contact_at + interval '3 days' AS at) f
WHERE l.first_contact_at IS NOT NULL AND l.code % 2 = 0 AND f.at < now();

INSERT INTO messages (id, lead_id, channel, direction, mode, body, status, received_at,
  classification, classification_source, created_at, updated_at)
SELECT gen_random_uuid(), l.id, 'WHATSAPP', 'INBOUND', 'LOGGED', 'Resposta fictícia.', 'RECEIVED',
  l.first_reply_at,
  (ARRAY['INTERESTED', 'OBJECTION', 'QUESTION', 'NOT_INTERESTED', 'OTHER'])[1 + l.code % 5]::reply_classification,
  'HUMAN', l.first_reply_at, now()
FROM leads l WHERE l.first_reply_at IS NOT NULL;

INSERT INTO activities (id, lead_id, user_id, type, direction, outcome, occurred_at)
SELECT gen_random_uuid(), l.id, l.owner_id, 'CALL', 'OUTBOUND', 'NO_ANSWER',
  l.first_contact_at + interval '1 hour'
FROM leads l WHERE l.first_contact_at IS NOT NULL AND l.code % 7 = 0;

INSERT INTO opportunities (id, lead_id, sdr_id, sales_owner_id, status, handoff_at, accept_due_at,
  qualification, won_at, conversion_type, updated_at)
SELECT gen_random_uuid(), l.id, l.owner_id, c.sales,
  CASE WHEN l.code % 3 = 0 THEN 'WON' ELSE 'OPEN' END::opportunity_status,
  LEAST(l.first_reply_at + interval '1 day', now()), LEAST(l.first_reply_at + interval '2 days', now()),
  '{}'::jsonb,
  CASE WHEN l.code % 3 = 0 THEN LEAST(l.first_reply_at + interval '6 days', now()) END,
  CASE WHEN l.code % 3 = 0 THEN (ARRAY['PARTNER', 'CUSTOMER'])[1 + l.code % 2]::conversion_type END,
  now()
FROM leads l CROSS JOIN perf_ctx c
WHERE l.first_reply_at IS NOT NULL AND l.code % 5 = 0;

INSERT INTO suppression_entries (id, type, value_hash, value_masked, reason, source, lead_id, created_at)
SELECT gen_random_uuid(), 'LEAD', l.id::text, 'Lead', 'OPT_OUT', 'SDR', l.id,
  LEAST(l.created_at + interval '4 days', now())
FROM leads l WHERE l.code % 200 = 0;

INSERT INTO tasks (id, lead_id, assignee_id, type, title, due_at, status, updated_at)
SELECT gen_random_uuid(), l.id, l.owner_id, 'FOLLOW_UP', 'Follow-up (teste de desempenho)',
  now() + ((l.code % 10) - 5) * interval '1 day', 'OPEN', now()
FROM leads l WHERE l.owner_id IS NOT NULL AND l.status = 'ACTIVE' AND l.code % 4 = 0;

ANALYZE;
`;

async function measure(name: string, fn: () => Promise<unknown>) {
  const times: number[] = [];
  await fn(); // aquece (planos e conexões)
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint();
    await fn();
    times.push(elapsed(start));
  }
  times.sort((a, b) => a - b);
  return { name, min: times[0]!, median: times[Math.floor(times.length / 2)]!, max: times.at(-1)! };
}

if (!values['skip-seed']) {
  console.log(`Recriando ${dbName} e carregando ${LEADS} leads fictícios…`);
  await recreateDatabase();
  const client = createDbClient(url, { maxConnections: 1 });
  const start = process.hrtime.bigint();
  // Uma transação: a tabela temporária de contexto vale para todos os comandos.
  await client.$transaction(
    async (tx) => {
      for (const statement of SEED_SQL(LEADS).split(/;\s*\n/)) {
        if (statement.trim()) await tx.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30 * 60 * 1000, maxWait: 60_000 },
  );
  console.log(`Carga em ${(elapsed(start) / 1000).toFixed(1)} s.`);
  await client.$disconnect();
}

const db = createDbClient(url, { maxConnections: 5 });
const deps: CoreDeps = {
  db,
  clock: systemClock,
  logger: createLogger({ service: 'cli', level: 'warn', appEnv: 'test' }),
  email: { send: async () => undefined } as never,
  passwordHasher: { hash: async (v: string) => v },
  identifiers: createIdentifierHasher('perf-pepper-com-pelo-menos-32-caracteres!!'),
  appUrl: 'http://localhost',
  jobs: { enqueue: async () => null },
  importLimits: { maxBytes: 1, maxRows: 1 },
  ai: new FakeAiProvider(),
  aiLimits: {
    effortGeneration: 'medium',
    effortClassification: 'low',
    maxGenerationsPerUserPerDay: 200,
    monthlyBudgetUsd: null,
  },
  whatsapp: null,
  instagram: null,
};

try {
  const users = await db.user.findMany({
    select: { id: true, role: true },
    orderBy: { email: 'asc' },
  });
  const actorOf = (u: { id: string; role: string }): Extract<Actor, { kind: 'user' }> => ({
    kind: 'user',
    id: u.id,
    role: u.role as never,
    status: 'ACTIVE',
    teamId: null,
  });
  const manager = actorOf(users.find((u) => u.role === 'MANAGER')!);
  const someLead = await db.lead.findFirstOrThrow({
    where: { ownerId: { not: null }, firstReplyAt: { not: null } },
    select: { id: true, municipalityCode: true, ownerId: true },
  });
  const sdr = actorOf(users.find((u) => u.id === someLead.ownerId)!);
  const counts = await db.$queryRaw<{ leads: number; messages: number; opportunities: number }[]>`
    SELECT (SELECT count(*)::int FROM leads) AS leads, (SELECT count(*)::int FROM messages) AS messages,
           (SELECT count(*)::int FROM opportunities) AS opportunities`;
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  const results = [];
  results.push(
    await measure('Lista de leads (50, atividade recente)', () => searchLeads(deps, manager, {})),
  );
  results.push(
    await measure('Lista filtrada (cidade + faixa)', () =>
      searchLeads(deps, manager, {
        filter: {
          all: [
            { field: 'city', op: 'in', value: [someLead.municipalityCode] },
            { field: 'scoreBand', op: 'in', value: ['HOT', 'PRIORITY'] },
          ],
        },
      }),
    ),
  );
  results.push(
    await measure('Busca por nome (trigram)', () =>
      searchLeads(deps, manager, { q: 'desempenho 4567' }),
    ),
  );
  results.push(await measure('Contagem total', () => countLeads(deps, manager, {})));
  results.push(
    await measure('Ficha do lead', () => getLead(deps, manager, { leadId: someLead.id })),
  );
  results.push(
    await measure('Kanban (pipeline padrão)', () => getPipelineBoard(deps, manager, {})),
  );
  results.push(await measure('Minha Fila (SDR)', () => getMyQueue(deps, sdr, {})));
  results.push(await measure('Dashboard equipe, 30 dias', () => getDashboard(deps, manager, {})));
  results.push(
    await measure('Dashboard equipe, 90 dias', () =>
      getDashboard(deps, manager, { from: daysAgo(89), to: today }),
    ),
  );
  results.push(
    await measure('Dashboard equipe, 366 dias', () =>
      getDashboard(deps, manager, { from: daysAgo(365), to: today }),
    ),
  );
  results.push(await measure('Dashboard SDR, 30 dias', () => getDashboard(deps, sdr, {})));
  results.push(
    await measure('Relatório por cidade, 366 dias', () =>
      getAnalyticsBreakdown(deps, manager, { from: daysAgo(365), to: today, dimension: 'city' }),
    ),
  );
  results.push(
    await measure('Exportação diária, 366 dias', () =>
      exportAnalyticsReport(deps, manager, { from: daysAgo(365), to: today, report: 'daily' }),
    ),
  );
  results.push(await measure('Uso e custos da IA (mês)', () => getAiUsage(deps, manager, {})));

  const c = counts[0]!;
  console.log(
    `\n${c.leads} leads · ${c.messages} mensagens · ${c.opportunities} oportunidades · ${RUNS} medições por item\n`,
  );
  console.log('| Leitura | mín. (ms) | mediana (ms) | máx. (ms) |');
  console.log('|---|---:|---:|---:|');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.min.toFixed(0)} | ${r.median.toFixed(0)} | ${r.max.toFixed(0)} |`,
    );
  }
} finally {
  await db.$disconnect();
}
