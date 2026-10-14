import { expect, test, type Browser } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, appAlert, freshTotp, lastInviteLinkFor, setPassword, signIn } from './helpers';

/**
 * Limite de login por conta (F2-18; docs/SECURITY.md §12) e verificação em
 * duas etapas (F2-16). Roda depois da suíte da API (usa a SDR criada lá). O IP
 * vem do X-Forwarded-For com um único IP, aceito quando TRUSTED_PROXIES está vazio.
 */
test.describe.configure({ mode: 'serial' });

const OWNER = { email: 'carla@e2e.example', password: 'girassol-trem-azul-nuvem' };
const MANAGER = {
  name: 'Gil Gestor',
  email: 'gil@e2e.example',
  password: 'pipoca-lua-cadeira-trem',
};

async function browserFrom(browser: Browser, ip: string) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': ip },
  });
  return { context, page: await context.newPage() };
}

test('quem erra a senha espera cada vez mais; a dona da conta continua entrando', async ({
  browser,
}) => {
  // Colega no escritório (IP do escritório), sem o navegador da dona da conta.
  const attacker = await browserFrom(browser, '198.51.100.7');
  for (let i = 0; i < 5; i++) {
    await signIn(attacker.page, OWNER.email, 'senha-errada-de-proposito', { expectSuccess: false });
    await expect(appAlert(attacker.page)).toContainText('E-mail ou senha incorretos.');
  }
  // Na 6ª, nem a senha certa é conferida: precisa esperar.
  await signIn(attacker.page, OWNER.email, OWNER.password, { expectSuccess: false });
  await expect(appAlert(attacker.page)).toContainText(
    /Muitas tentativas com senha errada\. Tente de novo em \d+ segundos\./,
  );

  // A dona da conta, de casa (outro IP), entra normalmente.
  const owner = await browserFrom(browser, '192.0.2.44');
  await signIn(owner.page, OWNER.email, OWNER.password);

  // Depois, o colega erra a senha do mesmo IP da casa dela...
  const sameIp = await browserFrom(browser, '192.0.2.44');
  for (let i = 0; i < 6; i++) {
    await signIn(sameIp.page, OWNER.email, 'senha-errada-de-proposito', { expectSuccess: false });
    await expect(appAlert(sameIp.page)).toBeVisible();
  }
  await expect(appAlert(sameIp.page)).toContainText('Muitas tentativas');

  // ...e ela, no navegador em que já entrou, segue entrando.
  await owner.context.clearCookies({ name: 'docline.session_token' });
  await signIn(owner.page, OWNER.email, OWNER.password);

  await Promise.all([attacker.context.close(), owner.context.close(), sameIp.context.close()]);
});

test('gestor ativa a verificação em duas etapas e entra com o código ou com um código de recuperação', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Administradora convida o gestor.
  const admin = await browser.newContext({ baseURL });
  const adminPage = await admin.newPage();
  await signIn(adminPage, ADMIN.email, ADMIN.password);
  const invited = await adminPage.request.post('/api/v1/users', {
    data: { name: MANAGER.name, email: MANAGER.email, role: 'MANAGER' },
    headers: { origin: baseURL },
  });
  expect(invited.status()).toBe(201);

  const manager = await browser.newContext({ baseURL });
  const page = await manager.newPage();
  await page.goto(lastInviteLinkFor(MANAGER.email));
  await setPassword(page, MANAGER.password);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByText('Proteja sua conta: ative a verificação em duas etapas'),
  ).toBeVisible();

  // Ativação: senha, QR/chave, código do aplicativo e códigos de recuperação.
  await page.getByRole('link', { name: 'Ativar agora' }).click();
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  await page.getByLabel('Confirme sua senha').fill(MANAGER.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    page.getByRole('img', { name: 'QR code para o aplicativo autenticador' }),
  ).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
  const used = new Set<string>();
  await page.getByLabel('Código do aplicativo').fill(await freshTotp(page, secret, used));
  await page.getByRole('button', { name: 'Confirmar e ativar' }).click();
  await expect(page.getByText('Verificação em duas etapas ativada.')).toBeVisible();
  const codes = await page
    .getByRole('list', { name: 'Códigos de recuperação' })
    .getByRole('listitem')
    .allInnerTexts();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByText('Ativada', { exact: true })).toBeVisible();
  await expect(page.getByText('Proteja sua conta')).toHaveCount(0);

  // Novo login: a senha sozinha não basta; código errado é recusado.
  await manager.clearCookies();
  await signIn(page, MANAGER.email, MANAGER.password, { expectSuccess: false });
  await expect(page).toHaveURL(/\/login\/verificacao/);
  await page.getByLabel('Código do aplicativo').fill('000000');
  await page.getByRole('button', { name: 'Verificar e entrar' }).click();
  await expect(appAlert(page)).toContainText('Código incorreto');
  await page.getByLabel('Código do aplicativo').fill(await freshTotp(page, secret, used));
  await page.getByRole('button', { name: 'Verificar e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Sem o celular: código de recuperação (vale uma vez).
  await manager.clearCookies();
  await signIn(page, MANAGER.email, MANAGER.password, { expectSuccess: false });
  await expect(page).toHaveURL(/\/login\/verificacao/);
  await page.getByRole('button', { name: /usar código de recuperação/ }).click();
  await page.getByLabel('Código de recuperação').fill(codes[0]!);
  await page.getByRole('button', { name: 'Verificar e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // A auditoria registra a ativação.
  await adminPage.goto('/configuracoes/auditoria');
  await expect(
    adminPage.getByRole('cell', { name: 'Verificação em duas etapas ativada' }).first(),
  ).toBeVisible();

  await Promise.all([admin.close(), manager.close()]);
});
