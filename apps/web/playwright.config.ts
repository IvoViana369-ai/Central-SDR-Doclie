import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://docline:docline@localhost:5432/docline_sdr_test';
export const OUTBOX_FILE = fileURLToPath(new URL('./e2e/.state/outbox.jsonl', import.meta.url));

/** Navegador pré-instalado (ambientes sem download de browsers). */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Prepara o banco de testes e sobe o build de produção (rode `pnpm build` antes).
    command: `node e2e/prepare.mjs && pnpm start`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      PORT: String(PORT),
      APP_ENV: 'test',
      APP_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      DATABASE_URL: testDatabaseUrl,
      EMAIL_PROVIDER: 'file',
      EMAIL_OUTBOX_FILE: OUTBOX_FILE,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? 'e2e-secret-com-pelo-menos-32-caracteres!!',
      LOG_LEVEL: 'warn',
    },
  },
});
