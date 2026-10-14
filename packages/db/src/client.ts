import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type DbClient = PrismaClient;

export interface CreateDbClientOptions {
  /** Tamanho máximo do pool de conexões deste processo. */
  maxConnections?: number;
}

export function createDbClient(databaseUrl: string, options: CreateDbClientOptions = {}): DbClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: options.maxConnections ?? 10,
  });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { __doclineDb?: DbClient };

/**
 * Cliente compartilhado do processo (reaproveitado entre recargas do Next.js em
 * desenvolvimento). Usa `DATABASE_URL`, validada na inicialização da aplicação.
 */
export function getDb(): DbClient {
  if (!globalForDb.__doclineDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definida');
    globalForDb.__doclineDb = createDbClient(url);
  }
  return globalForDb.__doclineDb;
}
