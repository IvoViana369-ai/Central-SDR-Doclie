import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertTestDatabaseUrl } from './safety';

/** Recria o schema do banco de testes e aplica as migrações uma vez por execução. */
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
}
