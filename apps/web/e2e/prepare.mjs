/**
 * Prepara o banco de testes para a suíte E2E (executado antes do servidor subir):
 * recria o schema, aplica as migrações e cria a administradora inicial pelo CLI.
 * Recusa qualquer banco cujo nome não termine em _test.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const name = url ? new URL(url).pathname.slice(1) : '';
if (!name.endsWith('_test')) {
  throw new Error(`E2E recusado: o banco "${name}" não termina em _test.`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();

execFileSync('pnpm', ['--filter', '@docline/db', 'exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'pipe',
});

rmSync(process.env.EMAIL_OUTBOX_FILE, { force: true });
const output = execFileSync(
  'pnpm',
  ['--silent', 'admin:create', '--email', 'admin@e2e.example', '--name', 'Ana Administradora'],
  { encoding: 'utf8' },
);
const inviteUrl = output.match(/https?:\/\/\S+\/convite\/\S+/)?.[0];
if (!inviteUrl) throw new Error(`Link de convite não encontrado na saída do CLI:\n${output}`);

const statePath = new URL('./.state/admin-invite.json', import.meta.url);
mkdirSync(dirname(statePath.pathname), { recursive: true });
writeFileSync(statePath, JSON.stringify({ inviteUrl }));
console.log('[e2e] banco de testes preparado');
