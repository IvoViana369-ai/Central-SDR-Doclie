/**
 * Cria o primeiro administrador (ou qualquer usuário) por linha de comando.
 *
 *   pnpm admin:create --email admin@docline.com.br --name "Nome Sobrenome" [--role ADMIN]
 *
 * Imprime o link de convite (válido por 72h) para a pessoa definir a senha. O link
 * também é enviado por e-mail quando o provedor estiver configurado.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getServerEnv } from '@docline/config';
import {
  createIdentifierHasher,
  inviteUser,
  isDomainError,
  systemActor,
  systemClock,
  ValidationError,
} from '@docline/core';
import { createDbClient } from '@docline/db';
import { createEmailProvider, createLogger, LazyPgBossJobQueue } from '@docline/integrations';
import { hashPassword } from 'better-auth/crypto';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'ADMIN' },
  },
});

if (!values.email || !values.name) {
  console.error(
    'Uso: pnpm admin:create --email <email> --name "<nome>" [--role ADMIN|MANAGER|SDR|SALES]',
  );
  process.exit(2);
}

const env = getServerEnv();
const logger = createLogger({ service: 'cli', level: env.LOG_LEVEL, appEnv: env.APP_ENV });
const db = createDbClient(env.DATABASE_URL, { maxConnections: 2 });
const jobs = new LazyPgBossJobQueue({
  connectionString: env.DATABASE_URL,
  schema: env.JOB_QUEUE_SCHEMA,
  logger,
});

try {
  const result = await inviteUser(
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
    },
    systemActor('cli:admin:create'),
    { email: values.email, name: values.name, role: values.role as never },
  );
  console.log(`Usuário criado: ${result.email}`);
  console.log(
    `E-mail de convite: ${result.emailSent ? 'enviado' : 'NÃO enviado (verifique EMAIL_PROVIDER)'}`,
  );
  console.log(`Link para definir a senha (válido até ${result.expiresAt.toISOString()}):`);
  console.log(result.inviteUrl);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(
      `Dados inválidos: ${error.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  } else if (isDomainError(error)) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await jobs.stop();
  await db.$disconnect();
}
