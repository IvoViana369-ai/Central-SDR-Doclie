import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, appAlert, lastInviteLinkFor, setPassword, signIn, watchCsp } from './helpers';

/**
 * Fase 9: base aberta do CNPJ simulada (escritórios fictícios, CNPJs com raiz
 * "FK"), carregada pelo worker como a da Receita. Prospecção com comparação e
 * aprovação, potencial por cidade e "Completar com dados abertos" na ficha.
 * Com E2E_SCREENSHOT_DIR, guarda capturas das telas.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
/** SDR fictício convidado só para esta fase. */
const SDR9 = {
  name: 'Clara Prospecção',
  email: 'clara.fase9@e2e.example',
  password: 'sdr-fase9-senha-forte-do-teste',
};

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

let searchId = '';

test('ADMIN roda a carga da base aberta simulada e acompanha pelo painel', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes');
  await page.getByRole('link', { name: /Dados abertos do CNPJ/ }).click();
  await expect(page).toHaveURL(/\/configuracoes\/dados-cnpj$/);
  await expect(page.getByText('Simulada (escritórios fictícios)')).toBeVisible();
  await expect(page.getByTestId('registry-current')).toHaveText('Nenhum');

  await page.getByRole('button', { name: 'Rodar a carga agora' }).click();
  await expect(page.getByText(/Carga iniciada/)).toBeVisible();
  // O worker baixa e lê os arquivos simulados (mesmo formato da Receita).
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('registry-current')).toContainText('2026-09', {
      timeout: 1000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByTestId('registry-ingestion').first()).toContainText('Concluída');
  await expect(page.getByText('CE: 28 · PI: 2')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dados-cnpj.png`, fullPage: true });
  assertNoCsp();
});

test('Prospecção: busca na cidade, comparação com a base, aprovação e recusa', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  // Um lead que já existe com o mesmo nome na mesma cidade (sem CNPJ).
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const existing = await a.post('/leads', {
    tradeName: 'Gama Contadores Associados',
    municipalityCode: sobral,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'REFERRAL')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    acknowledgeDuplicates: true,
  });
  expect(existing.status()).toBe(201);

  await page.getByRole('link', { name: 'Prospecção', exact: true }).click();
  await expect(page).toHaveURL(/\/prospeccao$/);
  await expect(page.getByText(/mês 2026-09/)).toBeVisible();
  await page.getByLabel('UF', { exact: true }).selectOption('CE');
  await page.getByLabel('Cidades', { exact: true }).fill('Sobral');
  await page.getByRole('option', { name: /Sobral/ }).click();
  await expect(page.getByRole('list', { name: 'Cidades escolhidas' })).toContainText('Sobral');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(/\/prospeccao\?busca=/);
  searchId = new URL(page.url()).searchParams.get('busca')!;

  const rows = page.getByTestId('prospect-row');
  await expect(rows).toHaveCount(8);
  const gama = rows.filter({ hasText: 'Gama Contadores Associados' });
  await expect(gama).toContainText('Já existe');
  await expect(gama).toContainText('Mesmo nome na mesma cidade');
  const horizonte = rows.filter({ hasText: 'Contabilidade Horizonte' });
  await expect(horizonte).toContainText('Novo');
  await expect(horizonte).toContainText('(88) 3611-0008');

  await page.getByLabel('Selecionar Contabilidade Horizonte').check();
  await page.getByLabel('Selecionar Atlas Contadores Associados').check();
  await page.getByRole('button', { name: 'Aprovar (2)' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Dados abertos CNPJ');
  await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('2 leads criados, 0 completados.')).toBeVisible();
  await expect(horizonte).toContainText('Aprovado');

  await page.getByLabel('Selecionar Sigma Assessoria Contábil').check();
  await page.getByRole('button', { name: 'Recusar (1)' }).click();
  await page.getByLabel('Motivo (opcional)').fill('Fora do perfil');
  await page.getByRole('dialog').getByRole('button', { name: 'Recusar', exact: true }).click();
  await expect(page.getByText('1 recusado.')).toBeVisible();
  await expect(rows.filter({ hasText: 'Sigma Assessoria Contábil' })).toContainText(
    'Fora do perfil',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prospeccao.png`, fullPage: true });

  // O lead novo: origem "Dados abertos CNPJ" e nada mais a completar pela base.
  await horizonte.getByRole('link', { name: /^Lead / }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByText('Dados abertos CNPJ (Receita Federal)').first()).toBeVisible();
  await expect(page.getByTestId('registry-card')).toContainText('Nada a completar');
  assertNoCsp();
});

test('potencial por cidade e busca a partir dele', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/prospeccao');
  await page.getByRole('link', { name: 'Potencial por cidade' }).click();
  const rows = page.getByTestId('potential-row');
  await expect(rows.first()).toContainText('Fortaleza');
  const sobral = rows.filter({ hasText: 'Sobral' });
  // 8 escritórios, 2 já viraram lead (aprovados acima), faltam 6.
  await expect(sobral.getByTestId('potential-offices')).toHaveText('8');
  await expect(sobral.getByTestId('potential-in-base')).toHaveText('2');
  await expect(sobral.getByTestId('potential-remaining')).toHaveText('6');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prospeccao-potencial.png`, fullPage: true });

  await rows.filter({ hasText: 'Fortaleza' }).getByRole('link', { name: 'Buscar' }).click();
  await expect(page.getByRole('list', { name: 'Cidades escolhidas' })).toContainText('Fortaleza');
  assertNoCsp();
});

test('ficha: completar com dados abertos pelo CNPJ (só o que está vazio)', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const detail = await a.json<{
    results: { cnpj: string; company: { tradeName: string | null } | null }[];
  }>(`/prospecting/searches/${searchId}`);
  const omega = detail.results.find((r) => r.company?.tradeName === 'Escritório Contábil Ômega')!;
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const created = await a.post('/leads', {
    tradeName: 'Ômega Antigo',
    cnpj: omega.cnpj,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'REFERRAL')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  const leadId = ((await created.json()) as { id: string }).id;

  await page.goto(`/leads/${leadId}`);
  const card = page.getByTestId('registry-card');
  await expect(card).toContainText('Escritório Contábil Ômega Ltda');
  await expect(card).toContainText('razão social');
  await expect(card).toContainText('cidade');
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/ficha-dados-cnpj.png` });
  await card.getByRole('button', { name: 'Completar com dados abertos' }).click();
  await expect(card.getByText('Lead completado com os dados abertos do CNPJ.')).toBeVisible();
  await expect(card).toContainText('Nada a completar');
  // O nome fantasia que já existia fica; a razão social e a cidade entram.
  await expect(page.getByRole('heading', { name: 'Ômega Antigo' })).toBeVisible();
  await expect(page.getByText('Sobral/CE').first()).toBeVisible();
  await expect(appAlert(page)).toHaveCount(0);
  assertNoCsp();
});

test('SDR não vê a Prospecção nem a carga da base', async ({ browser }) => {
  // SDR próprio (o da Fase 1 é desativado lá).
  const admin = await browser.newContext({ baseURL });
  const adminPage = await admin.newPage();
  await signIn(adminPage, ADMIN.email, ADMIN.password);
  const invited = await adminPage.request.post('/api/v1/users', {
    data: { name: SDR9.name, email: SDR9.email, role: 'SDR' },
    headers: { origin: baseURL },
  });
  expect(invited.status()).toBe(201);
  await admin.close();

  const sdr = await browser.newContext({ baseURL });
  const page = await sdr.newPage();
  await page.goto(lastInviteLinkFor(SDR9.email));
  await setPassword(page, SDR9.password);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Prospecção', exact: true })).toHaveCount(0);
  await page.goto('/prospeccao');
  await expect(page.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
  await page.goto('/configuracoes/dados-cnpj');
  await expect(page.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
  const response = await page.request.post('/api/v1/prospecting/searches', {
    data: { uf: 'CE' },
    headers: { origin: baseURL },
  });
  expect(response.status()).toBe(403);
  await sdr.close();
});
