import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Carrega o .env local (se existir) para obter DATABASE_URL_TEST.
if (existsSync('.env')) process.loadEnvFile('.env');

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://docline:docline@localhost:5432/docline_sdr_test';

/**
 * Projetos de teste (docs/ARCHITECTURE.md §12):
 * - unit: rápidos, sem I/O (*.test.ts).
 * - integration: PostgreSQL real (*.int.test.ts), em série, banco *_test recriado.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/*/src/**/*.int.test.ts', 'apps/*/src/**/*.int.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          globalSetup: ['./packages/db/test/global-setup.ts'],
          env: {
            APP_ENV: 'test',
            DATABASE_URL_TEST: testDatabaseUrl,
            DATABASE_URL: testDatabaseUrl,
          },
        },
      },
    ],
  },
});
