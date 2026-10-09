import 'server-only';
import { getServerEnv, type ServerEnv } from '@docline/config';
import { createIdentifierHasher, systemClock, type CoreDeps } from '@docline/core';
import { getDb } from '@docline/db';
import {
  assertProvidersImplemented,
  createEmailProvider,
  createErrorReporter,
  createLogger,
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
  };
  const errors = createErrorReporter({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    service: 'web',
  });
  globalForContainer.__doclineWeb = { env, logger, deps, errors };
  return globalForContainer.__doclineWeb;
}
