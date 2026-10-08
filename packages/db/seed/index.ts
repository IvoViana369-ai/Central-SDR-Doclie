import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDbClient } from '../src/client';
import { seedReference } from './reference';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');

const db = createDbClient(url, { maxConnections: 2 });
try {
  const result = await seedReference(db);
  console.log(
    `Referência: ${result.states} UFs, ${result.municipalities} municípios, ${result.holidays} feriados, ` +
      `${result.leadSources} origens, ${result.segments} segmentos.`,
  );
} finally {
  await db.$disconnect();
}
