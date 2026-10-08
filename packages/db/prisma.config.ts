import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env automaticamente; usamos o .env da raiz do monorepo.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx seed/index.ts',
  },
  // `prisma generate` não precisa de banco (roda no postinstall de instalações
  // limpas: CI, imagem Docker). Migrações sem DATABASE_URL falham com erro claro.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
