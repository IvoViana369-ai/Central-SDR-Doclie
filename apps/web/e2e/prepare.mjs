/**
 * Prepara o banco de testes para a suíte E2E (executado antes do servidor subir):
 * recria o schema, aplica as migrações, carrega os dados de referência e cria a
 * administradora inicial pelo CLI.
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
// Dados de referência (UFs, municípios, origens, segmentos), como no deploy.
execFileSync('pnpm', ['--filter', '@docline/db', 'seed'], { stdio: 'pipe' });

// O E2E roda a qualquer hora e em qualquer dia: janela de contato aberta o dia
// todo e sem feriados. Janela, feriados e limites têm testes próprios com
// relógio fixo (packages/core). A cadência tem janela própria (08:00–18:00 no
// seed): sem abri-la também, depois das 18h o primeiro passo vence no dia
// seguinte e some de "Hoje" na Minha Fila.
const settings = new pg.Client({ connectionString: url });
await settings.connect();
await settings.query('DELETE FROM holidays');
await settings.query(
  `INSERT INTO app_settings (key, value, updated_at) VALUES ('contact.rules', $1, now())`,
  [JSON.stringify({ windowStart: '00:00', windowEnd: '24:00', workDays: [0, 1, 2, 3, 4, 5, 6] })],
);
await settings.query(`UPDATE cadences SET send_window_start = '00:00', send_window_end = '24:00'`);
await settings.end();

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
