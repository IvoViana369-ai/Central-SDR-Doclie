import { expect, test, type Browser } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { appAlert, signIn } from './helpers';

/**
 * Limite de login por conta (F2-18; docs/SECURITY.md §12). Roda depois da
 * suíte da API (usa a SDR criada lá). O IP vem do X-Forwarded-For com um
 * único IP, aceito quando TRUSTED_PROXIES está vazio.
 */
test.describe.configure({ mode: 'serial' });

const OWNER = { email: 'carla@e2e.example', password: 'girassol-trem-azul-nuvem' };

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
