import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getServerEnv } from '@docline/config';
import { JOBS } from '@docline/core';
import { createDbClient } from '@docline/db';
import { assertProvidersImplemented, createLogger, startPgBoss } from '@docline/integrations';
import { recordHeartbeat } from './jobs/heartbeat';

// Em desenvolvimento, usa o .env da raiz do monorepo.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = getServerEnv();
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL, appEnv: env.APP_ENV });
assertProvidersImplemented(env);

const startedAt = new Date();
const db = createDbClient(env.DATABASE_URL, { maxConnections: 5 });
const boss = await startPgBoss({
  connectionString: env.DATABASE_URL,
  schema: env.JOB_QUEUE_SCHEMA,
  role: 'worker',
  logger,
});

// --- Registro dos jobs (docs/ARCHITECTURE.md §10) ---------------------------
await boss.work(JOBS.heartbeat.name, async () => {
  await recordHeartbeat(db, startedAt);
});
await boss.schedule(JOBS.heartbeat.name, JOBS.heartbeat.cron);
// Sinal imediato, sem esperar o primeiro minuto do cron.
await recordHeartbeat(db, startedAt);

logger.info({ jobs: Object.values(JOBS).map((j) => j.name) }, 'Worker iniciado');

// --- Encerramento gracioso ---------------------------------------------------
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Encerrando worker');
  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Falha ao encerrar o worker');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
