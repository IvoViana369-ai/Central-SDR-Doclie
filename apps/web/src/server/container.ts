import 'server-only';
import { getServerEnv, type ServerEnv } from '@docline/config';
import { createIdentifierHasher, systemClock, type CoreDeps } from '@docline/core';
import { getDb } from '@docline/db';
import {
  assertProvidersImplemented,
  aiLimitsFromEnv,
  createAiProvider,
  createEmailProvider,
  createErrorReporter,
  createLogger,
  LazyPgBossJobQueue,
  type AppLogger,
  type ErrorReporter,
} from '@docline/integrations';
import { hashPassword } from 'better-auth/crypto';

export interface WebContainer {
  env: ServerEnv;
  logger: AppLogger;
  deps: CoreDeps;
  /** Sentry, se `SENTRY_DSN` estiver configurado (senão, não envia nada). */
  errors: ErrorReporter;
}

const globalForContainer = globalThis as unknown as { __doclineWeb?: WebContainer };

/**
 * Composição das dependências do servidor web (uma vez por processo).
 * O ambiente é validado aqui: com configuração inválida, nenhuma rota responde.
 */
export function getContainer(): WebContainer {
  if (globalForContainer.__doclineWeb) return globalForContainer.__doclineWeb;

  const env = getServerEnv();
  assertProvidersImplemented(env);
  const logger = createLogger({ service: 'web', level: env.LOG_LEVEL, appEnv: env.APP_ENV });
  const deps: CoreDeps = {
    db: getDb(),
    clock: systemClock,
    logger,
    email: createEmailProvider(env, logger),
    // Mesmo algoritmo do Better Auth, para senhas definidas por convite.
    passwordHasher: { hash: hashPassword },
    identifiers: createIdentifierHasher(env.SUPPRESSION_HASH_PEPPER),
    appUrl: env.APP_URL,
    // O web só enfileira; os jobs rodam no worker.
    jobs: new LazyPgBossJobQueue({
      connectionString: env.DATABASE_URL,
      schema: env.JOB_QUEUE_SCHEMA,
      logger,
    }),
    importLimits: {
      maxBytes: env.IMPORT_MAX_FILE_MB * 1024 * 1024,
      maxRows: env.IMPORT_MAX_ROWS,
    },
    ai: createAiProvider(env),
    aiLimits: aiLimitsFromEnv(env),
  };
  const errors = createErrorReporter({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    service: 'web',
  });
  globalForContainer.__doclineWeb = { env, logger, deps, errors };
  return globalForContainer.__doclineWeb;
}
