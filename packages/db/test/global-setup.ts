import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedReference } from '../seed/reference';
import { createDbClient } from '../src/client';
import { assertTestDatabaseUrl } from './safety';

/**
 * Recria o schema do banco de testes, aplica as migrações e carrega os dados de
 * referência (UFs, municípios, feriados, origens, segmentos) uma vez por execução.
 */
export default async function setup(): Promise<void> {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const db = createDbClient(url, { maxConnections: 2 });
  try {
    await seedReference(db);
  } finally {
    await db.$disconnect();
  }
}
