import { createDbClient, type DbClient } from '../src/client';
import { assertTestDatabaseUrl } from './safety';

const REFERENCE_TABLES = ['_prisma_migrations', 'states', 'municipalities', 'holidays'];

let client: DbClient | undefined;

/** Cliente Prisma do banco de testes (compartilhado no arquivo de teste). */
export function getTestDb(): DbClient {
  client ??= createDbClient(assertTestDatabaseUrl(process.env.DATABASE_URL_TEST), {
    maxConnections: 4,
  });
  return client;
}

/**
 * Limpa todos os dados (exceto tabelas de referência) entre testes.
 * Usa a purga autorizada da auditoria (docline.audit_purge) dentro da transação.
 */
export async function resetTestData(db: DbClient = getTestDb()): Promise<void> {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = tables.map((t) => t.tablename).filter((t) => !REFERENCE_TABLES.includes(t));
  if (names.length === 0) return;
  await db.$transaction([
    db.$executeRawUnsafe(`SET LOCAL docline.audit_purge = 'on'`),
    db.$executeRawUnsafe(
      `TRUNCATE ${names.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE`,
    ),
  ]);
}

export async function closeTestDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
