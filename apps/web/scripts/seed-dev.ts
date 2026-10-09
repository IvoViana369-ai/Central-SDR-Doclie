/**
 * Base de desenvolvimento com ~2.000 empresas fictícias (F2-13), incluindo
 * duplicados propositais, opt-outs e leads arquivados.
 *
 *   pnpm db:seed:dev [--count 2000] [--seed 42]
 *
 * Só roda com APP_ENV=development. Se a base fictícia já existe, não faz nada
 * (para recomeçar: `pnpm --filter @docline/db exec prisma migrate reset`).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getServerEnv } from '@docline/config';
import { createIdentifierHasher, systemClock } from '@docline/core';
import { seedDevLeads } from '@docline/core/dev';
import { createDbClient } from '@docline/db';
import {
  aiLimitsFromEnv,
  createAiProvider,
  createEmailProvider,
  createInstagramProvider,
  createWhatsappProvider,
  createLogger,
  LazyPgBossJobQueue,
} from '@docline/integrations';
import { hashPassword } from 'better-auth/crypto';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '2000' },
    seed: { type: 'string', default: '42' },
  },
});
const count = Number(values.count);
const seed = Number(values.seed);
if (!Number.isInteger(count) || count < 1 || count > 20_000 || !Number.isInteger(seed)) {
  console.error('Uso: pnpm db:seed:dev [--count 1..20000] [--seed <inteiro>]');
  process.exit(2);
}

const env = getServerEnv();
if (env.APP_ENV !== 'development') {
  console.error(
    `Recusado: o seed fictício só roda com APP_ENV=development (atual: ${env.APP_ENV}).`,
  );
  process.exit(1);
}
const logger = createLogger({ service: 'cli', level: env.LOG_LEVEL, appEnv: env.APP_ENV });
const db = createDbClient(env.DATABASE_URL, { maxConnections: 2 });
const jobs = new LazyPgBossJobQueue({
  connectionString: env.DATABASE_URL,
  schema: env.JOB_QUEUE_SCHEMA,
  logger,
});

try {
  const started = Date.now();
  const result = await seedDevLeads(
    {
      db,
      clock: systemClock,
      logger,
      email: createEmailProvider(env, logger),
      passwordHasher: { hash: hashPassword },
      identifiers: createIdentifierHasher(env.SUPPRESSION_HASH_PEPPER),
      appUrl: env.APP_URL,
      jobs,
      importLimits: {
        maxBytes: env.IMPORT_MAX_FILE_MB * 1024 * 1024,
        maxRows: env.IMPORT_MAX_ROWS,
      },
      ai: createAiProvider(env),
      aiLimits: aiLimitsFromEnv(env),
      whatsapp: createWhatsappProvider(env),
      instagram: createInstagramProvider(env),
    },
    {
      count,
      seed,
      onProgress: (done) => {
        if (done % 250 === 0 || done === count) console.log(`${done}/${count} leads…`);
      },
    },
  );
  if (result.skipped) {
    console.log('A base fictícia já existe; nada foi feito.');
  } else {
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `Pronto em ${seconds}s: ${result.created} leads (${result.duplicates} duplicados propositais, ` +
        `${result.optedOut} opt-outs, ${result.archived} arquivados).`,
    );
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await jobs.stop();
  await db.$disconnect();
}
