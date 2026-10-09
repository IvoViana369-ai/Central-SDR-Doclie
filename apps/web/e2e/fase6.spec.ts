import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, lastInviteLinkFor, signIn, watchCsp } from './helpers';

/**
 * Fase 6: dashboard e relatórios (M16). Dados fictícios; a administradora
 * registra um contato e uma resposta pela API para movimentar os números.
 * Com E2E_SCREENSHOT_DIR, guarda capturas das telas (revisão visual).
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const SDR3 = {
  name: 'Carla Painel',
  email: 'carla.painel@e2e.example',
  password: 'sdr-painel-senha-forte-teste',
};

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: (path: string) => page.request.get(`/api/v1${path}`),
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

async function createOwnLead(page: Page, tradeName: string, phone: string): Promise<string> {
  const a = api(page);
  const me = await a.json<{ id: string }>('/me');
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const created = await a.post('/leads', {
    tradeName,
    municipalityCode: sobral,
    ownerId: me.id,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'GOOGLE')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: phone, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test('aceite M16: dashboard com indicadores, evolução diária, funis e quebras', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const id = await createOwnLead(page, 'Escritório Painel Teste', '(88) 99812-6601');
  const sentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  expect(
    (
      await a.post(`/leads/${id}/messages/logged`, {
        channel: 'WHATSAPP',
        body: 'Olá! Sou da Docline.',
        sentAt,
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await a.post(`/leads/${id}/replies`, {
        channel: 'WHATSAPP',
        body: 'Tenho interesse, pode explicar melhor?',
        classification: 'INTERESTED',
      })
    ).status(),
  ).toBe(201);

  const overview = await a.json<{
    kpis: { newLeads: number; contacted: number; responded: number; interested: number };
  }>('/analytics/overview');
  expect(overview.kpis.newLeads).toBeGreaterThanOrEqual(1);
  expect(overview.kpis.contacted).toBeGreaterThanOrEqual(1);
  expect(overview.kpis.responded).toBeGreaterThanOrEqual(1);
  expect(overview.kpis.interested).toBeGreaterThanOrEqual(1);

  await page.goto('/dashboard');
  await expect(page.getByText(/Números da equipe/)).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Indicadores do período' });
  for (const label of ['Novos leads', 'Contatados', 'Taxa de resposta', 'Interessados']) {
    await expect(kpis.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: /Evolução diária/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Leads por etapa' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sobral/CE' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

  // Tabela como alternativa ao gráfico.
  await page.getByRole('button', { name: 'Ver tabela' }).click();
  await expect(page.getByRole('columnheader', { name: 'Primeiros contatos' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver gráfico' }).click();

  // Atalho de período e filtro por pessoa ficam na URL.
  await page.getByRole('link', { name: 'Últimos 7 dias' }).click();
  await expect(page).toHaveURL(/\/dashboard\?de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('link', { name: 'Últimos 7 dias' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // Período inválido volta ao padrão com aviso, sem quebrar a página.
  await page.goto('/dashboard?de=2026-13-01');
  await expect(
    page.getByText(/Data inicial inválida\. Mostrando os últimos 30 dias\./),
  ).toBeVisible();

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/dashboard');
    await page.screenshot({ path: `${SHOTS}/dashboard-escuro.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  assertNoCsp();
});

test('aceite M16: relatórios completos com exportação CSV auditada', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/relatorios');
  await expect(page.getByRole('heading', { name: 'Relatórios', level: 1 })).toBeVisible();
  for (const title of ['Indicadores do período', 'Funil por etapa', 'Por SDR', 'Por cidade']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/relatorios.png`, fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#city').getByRole('link', { name: 'CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^relatorio-city-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );

  const exported = await api(page).get('/analytics/export?report=sdr');
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-type']).toContain('text/csv');
  expect(await exported.text()).toContain('Responsável;Leads ativos');

  const audit = await api(page).json<{ data: { metadata: { report: string } }[] }>(
    '/audit-logs?action=report.export',
  );
  expect(audit.data.map((e) => e.metadata.report)).toEqual(expect.arrayContaining(['city', 'sdr']));
  assertNoCsp();
});

test('M16: SDR vê só os próprios números e não acessa os relatórios', async ({ page, browser }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const invited = await api(page).post('/users', {
    name: SDR3.name,
    email: SDR3.email,
    role: 'SDR',
  });
  expect(invited.status()).toBe(201);

  const context = await browser.newContext({ baseURL });
  const sdrPage = await context.newPage();
  await sdrPage.goto(lastInviteLinkFor(SDR3.email));
  await sdrPage.getByLabel('Nova senha', { exact: true }).fill(SDR3.password);
  await sdrPage.getByLabel('Confirme a nova senha').fill(SDR3.password);
  await sdrPage.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(sdrPage).toHaveURL(/\/dashboard$/);
  await expect(sdrPage.getByText(/Seus números/)).toBeVisible();
  await expect(sdrPage.getByLabel('Pessoa')).toHaveCount(0);
  await expect(sdrPage.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);

  await sdrPage.goto('/relatorios');
  await expect(sdrPage.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
  expect((await api(sdrPage).get('/analytics/export?report=overview')).status()).toBe(403);
  await context.close();
});
