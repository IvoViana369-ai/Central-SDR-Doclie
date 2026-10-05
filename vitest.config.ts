import { defineConfig } from 'vitest/config';

/**
 * Projetos de teste (docs/ARCHITECTURE.md §12):
 * - unit: rápidos, sem I/O (*.test.ts).
 * - integration: usam PostgreSQL real (*.int.test.ts), executados em série.
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
          hookTimeout: 60_000,
          globalSetup: ['./packages/db/test/global-setup.ts'],
        },
      },
    ],
  },
});
