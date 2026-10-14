import { expect, test } from '@playwright/test';
import {
  ADMIN,
  SDR,
  adminInviteUrl,
  appAlert,
  lastInviteLinkFor,
  setPassword,
  signIn,
  watchCsp,
} from './helpers';

/**
 * Critério de aceite da Fase 1 (docs/ROADMAP.md): um ADMIN convida um SDR; o SDR
 * faz login e vê o layout; tentativas fora da permissão são negadas e auditadas.
 */
test.describe.configure({ mode: 'serial' });

test('administradora ativa o acesso pelo convite e chega ao dashboard', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await page.goto(adminInviteUrl());
  await expect(page.getByRole('heading', { name: 'Bem-vindo ao Docline SDR' })).toBeVisible();

  await setPassword(page, 'curta');
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(appAlert(page)).toContainText('pelo menos 12 caracteres');

  await setPassword(page, ADMIN.password);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Equipe' }),
  ).toBeVisible();
  assertNoCsp();
});

test('o link de convite não pode ser reutilizado', async ({ page }) => {
  await page.goto(adminInviteUrl());
  await setPassword(page, 'outra-senha-bem-longa-1');
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(appAlert(page)).toContainText('Convite inválido ou expirado');
});

test('administradora convida um SDR pela tela Equipe', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('link', { name: 'Equipe' }).first().click();
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
  await page.getByRole('button', { name: 'Convidar usuário' }).click();

  const dialog = page.getByRole('dialog', { name: 'Convidar usuário' });
  await dialog.getByLabel('Nome completo').fill(SDR.name);
  await dialog.getByLabel('E-mail corporativo').fill('não-é-email');
  await dialog.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(dialog.getByText('E-mail inválido.')).toBeVisible();

  await dialog.getByLabel('E-mail corporativo').fill(SDR.email);
  await dialog.getByLabel('Perfil').selectOption('SDR');
  await dialog.getByRole('button', { name: 'Enviar convite' }).click();

  await expect(page.getByText(`Convite enviado para ${SDR.email}.`)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(SDR.name) });
  await expect(row.getByText('Convidado')).toBeVisible();
  expect(lastInviteLinkFor(SDR.email)).toContain('/convite/');
  assertNoCsp();
});

test('SDR ativa o acesso e não enxerga nem acessa áreas de gestão', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await page.goto(lastInviteLinkFor(SDR.email));
  await setPassword(page, SDR.password);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Bruno!' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Configurações' })).toHaveCount(0);

  await page.goto('/equipe');
  await expect(page.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();

  // Mesmo chamando a API diretamente, a ação é negada no servidor.
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v1/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Intruso Teste', email: 'intruso@e2e.example', role: 'ADMIN' }),
    });
    return response.status;
  });
  expect(status).toBe(403);
  assertNoCsp();
});

test('auditoria registra convites, aceites e acessos negados', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes/auditoria');
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();

  const table = page.getByRole('table');
  await expect(table.getByText('Usuário convidado').first()).toBeVisible();
  await expect(table.getByText('Convite aceito').first()).toBeVisible();
  await expect(table.getByText('Acesso negado').first()).toBeVisible();
  await expect(table.getByText('Login').first()).toBeVisible();

  await page.getByLabel('Ação').selectOption('access.denied');
  await expect(table.getByText('Usuário convidado')).toHaveCount(0);
  await expect(table.getByRole('row', { name: /Bruno Prospector/ }).first()).toBeVisible();
});

test('senha errada mostra mensagem e é auditada como falha', async ({ page }) => {
  await signIn(page, ADMIN.email, 'senha-errada-qualquer', { expectSuccess: false });
  await expect(appAlert(page)).toContainText('E-mail ou senha incorretos.');

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes/auditoria');
  await page.getByLabel('Ação').selectOption('auth.login_failed');
  const row = page.getByRole('row', { name: /Falha de login/ }).first();
  await expect(row).toBeVisible();
  // O e-mail aparece mascarado na auditoria.
  await expect(row).toContainText('a***@e2e.example');
});

test('desativar o SDR encerra a sessão dele imediatamente', async ({ browser }) => {
  const sdrContext = await browser.newContext();
  const sdrPage = await sdrContext.newPage();
  await signIn(sdrPage, SDR.email, SDR.password);
  await expect(sdrPage).toHaveURL(/\/dashboard$/);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, ADMIN.email, ADMIN.password);
  await adminPage.goto('/equipe');
  adminPage.once('dialog', (dialog) => dialog.accept());
  await adminPage
    .getByRole('row', { name: new RegExp(SDR.name) })
    .getByRole('button', { name: 'Desativar' })
    .click();
  await expect(adminPage.getByText(`${SDR.name} foi desativado.`)).toBeVisible();

  await sdrPage.reload();
  await expect(sdrPage).toHaveURL(/\/login/);
  await signIn(sdrPage, SDR.email, SDR.password, { expectSuccess: false });
  await expect(appAlert(sdrPage)).toContainText('Usuário sem acesso ativo');

  await sdrContext.close();
  await adminContext.close();
});

test('no celular, o menu abre como gaveta', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await drawer.getByRole('link', { name: 'Equipe' }).click();
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
  await expect(drawer).toBeHidden();
  await context.close();
});
