import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getServerEnv } from '@docline/config';
import {
  ALL_JOBS,
  createIdentifierHasher,
  hasUnscoredLeads,
  JOBS,
  systemClock,
  type CoreDeps,
} from '@docline/core';
import { backfillLeadStages, createDbClient } from '@docline/db';
import {
  assertProvidersImplemented,
  aiLimitsFromEnv,
  createAiProvider,
  createEmailProvider,
  createInstagramProvider,
  createWhatsappProvider,
  createErrorReporter,
  createLogger,
  PgBossJobQueue,
  startPgBoss,
} from '@docline/integrations';
import { jobHandlers } from './jobs/handlers';

// Em desenvolvimento, usa o .env da raiz do monorepo.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = getServerEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL, appEnv: env.APP_ENV });
assertProvidersImplemented(env);
// Sentry, se `SENTRY_DSN` estiver configurado (senão, não envia nada).
const errors = createErrorReporter({
  dsn: env.SENTRY_DSN,
  environment: env.APP_ENV,
  service: 'worker',
});

/** Falha de job vai para o Sentry e volta para o pg-boss (que faz a retentativa). */
function reported<A extends unknown[], T>(job: string, handler: (...args: A) => Promise<T>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      errors.capture(error, { job });
      throw error;
    }
  };
}

const startedAt = new Date();
const db = createDbClient(env.DATABASE_URL, { maxConnections: 5 });
const boss = await startPgBoss({
  connectionString: env.DATABASE_URL,
  schema: env.JOB_QUEUE_SCHEMA,
  role: 'worker',
  logger,
});

// Mesmas dependências do web; aqui a fila é o próprio pg-boss do worker.
const deps: CoreDeps = {
  db,
  clock: systemClock,
  logger,
  email: createEmailProvider(env, logger),
  passwordHasher: {
    hash: () => Promise.reject(new Error('O worker não define senhas.')),
  },
  identifiers: createIdentifierHasher(env.SUPPRESSION_HASH_PEPPER),
  appUrl: env.APP_URL,
  jobs: new PgBossJobQueue(boss),
  importLimits: {
    maxBytes: env.IMPORT_MAX_FILE_MB * 1024 * 1024,
    maxRows: env.IMPORT_MAX_ROWS,
  },
  ai: createAiProvider(env),
  aiLimits: aiLimitsFromEnv(env),
  whatsapp: createWhatsappProvider(env),
  instagram: createInstagramProvider(env),
};

// --- Registro dos jobs (docs/ARCHITECTURE.md §10) ---------------------------
const handlers = jobHandlers(deps, startedAt);
for (const job of ALL_JOBS) {
  const handler = handlers[job.name];
  if (!handler) throw new Error(`Job sem handler no worker: ${job.name}`);
  await boss.work<object>(
    job.name,
    reported(job.name, async (jobs) => {
      for (const item of jobs) await handler(item.data);
    }),
  );
  if (job.cron) await boss.schedule(job.name, job.cron);
}
// Sinal imediato, sem esperar o primeiro minuto do cron.
await handlers[JOBS.heartbeat.name]!(undefined);

// --- Pipeline e score de leads antigos (Fase 4) ------------------------------
// Leads sem etapa (de antes do pipeline ou gravados por uma versão anterior
// durante o deploy) entram em "Novo"; quem ainda não tem score é calculado aqui.
const placed = await backfillLeadStages(db);
if (placed > 0) logger.info({ leads: placed }, 'Leads sem etapa colocados em "Novo"');
if (await hasUnscoredLeads(deps)) {
  await deps.jobs.enqueue(JOBS.scoreRecomputeAll.name, { trigger: 'backfill' });
}

logger.info({ jobs: ALL_JOBS.map((j) => j.name) }, 'Worker iniciado');

// --- Encerramento gracioso ---------------------------------------------------
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Encerrando worker');
  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
    await errors.flush();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Falha ao encerrar o worker');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
