import { expect, test, type APIRequestContext } from '@playwright/test';
import { baseURL, strictBaseURL } from '../playwright.config';
import { ADMIN, freshTotp, lastInviteLinkFor, setPassword, signIn } from './helpers';

/**
 * Verificação em duas etapas obrigatória para ADMIN e GESTOR (docs/SECURITY.md
 * §3), no servidor com TWO_FACTOR_ENFORCEMENT=required (o padrão de staging e
 * produção). Sem a 2FA, só "Minha conta"; a API v1 responde 403.
 */
test.describe.configure({ mode: 'serial' });

const SDR = {
  name: 'Davi Prospector',
  email: 'davi@e2e.example',
  password: 'jangada-sol-areia-vento',
};
const MANAGER = {
  name: 'Helena Gestora',
  email: 'helena@e2e.example',
  password: 'farol-mangue-canoa-sereno',
};

async function strictServerUp(request: APIRequestContext): Promise<number> {
  try {
    return (await request.get(`${strictBaseURL}/api/health`)).status();
  } catch {
    return 0;
  }
}

test.beforeAll(async ({ request }) => {
  // Sobe junto com o servidor principal (playwright.config.ts).
  await expect.poll(() => strictServerUp(request), { timeout: 60_000 }).toBe(200);
});

test('sem a verificação, o ADMIN só acessa Minha conta e a API responde 403; o SDR segue normal', async ({
  browser,
}) => {
  // A administradora convida um SDR e um gestor pelo servidor principal.
  const main = await browser.newContext({ baseURL });
  const mainPage = await main.newPage();
  await signIn(mainPage, ADMIN.email, ADMIN.password);
  for (const user of [
    { ...SDR, role: 'SDR' },
    { ...MANAGER, role: 'MANAGER' },
  ]) {
    const invited = await mainPage.request.post('/api/v1/users', {
      data: { name: user.name, email: user.email, role: user.role },
      headers: { origin: baseURL },
    });
    expect(invited.status()).toBe(201);
  }

  // Com a 2FA obrigatória, o login da ADMIN sem verificação termina em Minha conta.
  const strict = await browser.newContext({ baseURL: strictBaseURL });
  const page = await strict.newPage();
  await signIn(page, ADMIN.email, ADMIN.password, { expectSuccess: false });
  await expect(page).toHaveURL(/\/conta$/);
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  await expect(page.getByText('O menu é liberado depois de ativar')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ativar verificação em duas etapas' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/fase7-2fa-restrito.png', fullPage: true });

  // Qualquer outra página leva de volta; a API v1 recusa.
  for (const path of ['/leads', '/configuracoes/whatsapp', '/dashboard']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/conta$/);
  }
  const denied = await page.request.get('/api/v1/me');
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });

  // O SDR não precisa de 2FA: entra e usa o sistema.
  const sdrContext = await browser.newContext({ baseURL: strictBaseURL });
  const sdrPage = await sdrContext.newPage();
  await sdrPage.goto(lastInviteLinkFor(SDR.email).replace(baseURL, strictBaseURL));
  await setPassword(sdrPage, SDR.password);
  await sdrPage.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(sdrPage).toHaveURL(/\/dashboard$/);
  await sdrPage.goto('/leads');
  await expect(sdrPage).toHaveURL(/\/leads$/);
  expect((await sdrPage.request.get('/api/v1/me')).status()).toBe(200);

  await Promise.all([main.close(), strict.close(), sdrContext.close()]);
});

test('o gestor convidado ativa a verificação em Minha conta e o sistema é liberado', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const strict = await browser.newContext({ baseURL: strictBaseURL });
  const page = await strict.newPage();
  await page.goto(lastInviteLinkFor(MANAGER.email).replace(baseURL, strictBaseURL));
  await setPassword(page, MANAGER.password);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page).toHaveURL(/\/conta$/);
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  expect((await page.request.get('/api/v1/me')).status()).toBe(403);

  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  await page.getByLabel('Confirme sua senha').fill(MANAGER.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
  await page.getByLabel('Código do aplicativo').fill(await freshTotp(page, secret, new Set()));
  await page.getByRole('button', { name: 'Confirmar e ativar' }).click();
  await expect(page.getByText('Verificação em duas etapas ativada.')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText('Ativada', { exact: true })).toBeVisible();
  await expect(page.getByText('Acesso restrito')).toHaveCount(0);

  // Liberado: menu, páginas e API.
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/leads$/);
  await expect(
    page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Leads' }),
  ).toBeVisible();
  expect((await page.request.get('/api/v1/me')).status()).toBe(200);

  await strict.close();
});
