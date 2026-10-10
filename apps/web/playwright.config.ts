import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const PORT = 3100;
export const baseURL = `http://localhost:${PORT}`;
/**
 * Segundo servidor, no mesmo banco, com a 2FA obrigatória para ADMIN/GESTOR
 * (TWO_FACTOR_ENFORCEMENT=required, o padrão de staging e produção). O
 * principal roda em modo de lembrete porque a suíte entra como ADMIN dezenas de
 * vezes, e cada login com 2FA exigiria um código novo do aplicativo.
 */
const STRICT_PORT = 3101;
export const strictBaseURL = `http://localhost:${STRICT_PORT}`;
const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://docline:docline@localhost:5432/docline_sdr_test';
export const OUTBOX_FILE = fileURLToPath(new URL('./e2e/.state/outbox.jsonl', import.meta.url));
/** WhatsApp e Instagram simulados (Fases 7 e 8): os testes assinam os webhooks como a Meta. */
export const META_APP_SECRET = 'e2e-meta-app-secret-nao-real';
export const META_WEBHOOK_VERIFY_TOKEN = 'e2e-verify-token-nao-real';

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
  projects: [
    // Fases 1 a 9, em ordem alfabética (as primeiras contam os leads da base).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /fase1\d[^/]*\.spec\.ts$/,
    },
    // Fase 10 em diante: "fase10" viria antes de "fase2" na ordem alfabética.
    {
      name: 'chromium-fase10+',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /fase1\d[^/]*\.spec\.ts$/,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    // Prepara o banco de testes e sobe o build de produção (rode `pnpm build` antes)
    // junto com o worker, que processa importações e a busca de duplicados, e o
    // servidor com a 2FA obrigatória (porta própria, à espera em e2e/fase7-2fa).
    // Ficam no mesmo grupo de processos e são encerrados juntos.
    command:
      'node e2e/prepare.mjs && (pnpm --filter @docline/worker start & ' +
      `PORT=${STRICT_PORT} APP_URL=${strictBaseURL} BETTER_AUTH_URL=${strictBaseURL} ` +
      'TWO_FACTOR_ENFORCEMENT=required pnpm start & pnpm start)',
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
      SUPPRESSION_HASH_PEPPER:
        process.env.SUPPRESSION_HASH_PEPPER ?? 'e2e-pepper-com-pelo-menos-32-caracteres!!',
      LOG_LEVEL: 'warn',
      TWO_FACTOR_ENFORCEMENT: 'reminder',
      WHATSAPP_PROVIDER: 'fake',
      // Instagram simulado (Fase 8): mesmo app da Meta, mesma assinatura.
      INSTAGRAM_PROVIDER: 'fake',
      // Base aberta do CNPJ simulada (Fase 9): escritórios fictícios, carga pelo worker.
      COMPANY_REGISTRY_PROVIDER: 'fake',
      META_APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN,
    },
  },
});
