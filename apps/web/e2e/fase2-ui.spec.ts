import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, appAlert, signIn, watchCsp } from './helpers';

/**
 * Critérios de aceite da Fase 2 pela interface (docs/MVP.md M02, M03, M09, M14).
 * Roda depois das suítes da Fase 1 e da API (usa a administradora já ativa).
 */
test.describe.configure({ mode: 'serial' });

const LEAD = 'Escritório UI Fictício';
let leadUrl = '';

async function chooseCity(page: Page, name: string) {
  await page.getByLabel('Cidade', { exact: true }).fill(name);
  await page
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click();
}

/** Busca na lista. Redigita se o texto se perder (digitado antes da hidratação da página). */
async function searchLeads(page: Page, text: string, count: RegExp) {
  await expect(async () => {
    await page.getByLabel('Buscar leads').fill(text);
    await expect(page.getByTestId('lead-count')).toHaveText(count, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

test('administradora cria uma tag pela lista de leads', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/leads');
  await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
  await page.getByRole('button', { name: 'Tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tags' });
  await dialog.getByLabel('Nova tag').fill('Parceiro');
  await dialog.getByRole('button', { name: 'Criar' }).click();
  await expect(dialog.getByText('Tag "Parceiro" criada.')).toBeVisible();
  assertNoCsp();
});

test('cadastro completo: cidade, contato com WhatsApp, pessoa, origem e base legal', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/leads/novo');
  await page.getByLabel('Nome fantasia').fill(LEAD);
  await chooseCity(page, 'Sobral');
  await page.getByLabel('Telefone (contato 1)').fill('8765-4321');
  await page.getByLabel('WhatsApp').first().check();
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  await page.getByLabel('Nome da pessoa 1').fill('Paula Teste');
  await page.getByLabel('Cargo da pessoa 1').fill('Sócia');
  await page.getByLabel('Origem', { exact: true }).selectOption({ label: 'Indicação' });
  await expect(page.getByLabel('Base legal', { exact: true })).toHaveValue('LEGITIMATE_INTEREST');
  await page.getByLabel('Quem indicou').fill('Cliente fictício');
  await page.getByLabel('Parceiro').check();
  await page.getByRole('button', { name: 'Cadastrar lead' }).click();

  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  leadUrl = page.url();
  await expect(page.getByRole('heading', { name: LEAD })).toBeVisible();
  // Telefone sem DDD: completado com o DDD da cidade e com o 9º dígito.
  const contact = page.getByTestId('contact-point').first();
  await expect(contact).toContainText('(88) 98765-4321');
  // O WhatsApp abre o contato assistido (Fase 5), já com o número escolhido.
  await contact.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  const compose = page.getByRole('dialog', { name: 'Enviar mensagem' });
  await expect(compose).toContainText('Para: (88) 98765-4321');
  await compose.getByRole('button', { name: 'Cancelar' }).click();
  await expect(compose).toBeHidden();
  await expect(page.getByText('Paula Teste')).toBeVisible();
  // Timeline (M09).
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Lead cadastrado');
  assertNoCsp();
});

test('aceite M02: o mesmo telefone em outro formato é avisado antes de salvar', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/leads/novo');
  await page.getByLabel('Nome fantasia').fill('Outro Escritório UI');
  await page.getByLabel('Telefone (contato 1)').fill('+55 88 98765-4321');
  await page.getByLabel('Telefone (contato 1)').blur();
  await expect(page.getByText('Encontramos leads parecidos')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(LEAD) })).toBeVisible();

  await page.getByRole('button', { name: 'Cadastrar lead' }).click();
  await expect(appAlert(page).first()).toContainText('Encontramos leads parecidos');
  await page.getByRole('button', { name: 'Cadastrar mesmo assim' }).click();
  await expect(page.getByRole('heading', { name: 'Outro Escritório UI' })).toBeVisible();
});

test('aceite M03: busca, contagem com quebra e ação em massa com simulação', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/leads');
  await searchLeads(page, '(88) 98765-4321', /^2 leads · 2 contactáveis · 0 bloqueados/);

  await page.getByLabel('Selecionar todos da página').check();
  await page.getByRole('button', { name: 'Ação em massa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ação em massa' });
  await dialog.getByLabel('Ação').selectOption('addTag');
  await dialog.getByRole('button', { name: 'Simular' }).click();
  await expect(dialog.getByTestId('bulk-summary')).toHaveText(
    '2 leads selecionados · 2 contactáveis · 0 bloqueados',
  );
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Adicionar tag: 1 lead(s) alterado(s).')).toBeVisible();
  assertNoCsp();
});

test('aceite M14: opt-out em 1 clique bloqueia o WhatsApp e aparece na Lista Não Contatar', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(leadUrl);
  await page.getByRole('button', { name: 'Não contatar' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Registrar opt-out' });
  await dialog.getByRole('button', { name: 'Registrar opt-out' }).click();
  await expect(page.getByText('Lead na Lista Não Contatar', { exact: true })).toBeVisible();
  const contact = page.getByTestId('contact-point').first();
  await expect(contact.getByRole('button', { name: 'WhatsApp', exact: true })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Contato permitido por canal' })).toContainText(
    'WhatsApp: bloqueado',
  );

  await page.goto('/conformidade');
  await expect(page.getByRole('heading', { name: 'Conformidade' })).toBeVisible();
  await page.getByLabel('Buscar na lista pelo valor').fill('88987654321');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('+55 88 9****-4321')).toBeVisible();
  assertNoCsp();
});

test('exportação: CSV do filtro sem contatos da Lista Não Contatar, registrada na auditoria', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/leads');
  await searchLeads(page, '(88) 98765-4321', /^2 leads/);
  await page.getByRole('button', { name: 'Exportar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Exportar leads' });
  await expect(dialog.getByTestId('export-total')).toHaveText('2 lead(s) no filtro atual.');
  await dialog.getByLabel(/Incluir contatos/).check();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar CSV' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = readFileSync(await download.path(), 'utf8');
  expect(content).toContain(LEAD);
  // O telefone dos dois leads está na Lista Não Contatar (opt-out do aceite M14).
  expect(content).not.toContain('98765-4321');
  await expect(
    page.getByText('2 lead(s) exportado(s). 2 contato(s) da Lista Não Contatar ficaram de fora.'),
  ).toBeVisible();

  await page.goto('/configuracoes/auditoria');
  await expect(page.getByRole('cell', { name: 'Leads exportados' }).first()).toBeVisible();
  assertNoCsp();
});

test('no celular, o detalhe do lead é legível e mostra os contatos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(leadUrl);
  await expect(page.getByRole('heading', { name: LEAD })).toBeVisible();
  await expect(page.getByTestId('contact-point').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow, 'rolagem horizontal na página').toBe(false);
});
