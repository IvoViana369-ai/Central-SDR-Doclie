import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, lastInviteLinkFor, setPassword, signIn, watchCsp } from './helpers';

/**
 * Fase 11: relatórios sobre os rollups (conversão por recorte com intervalo de
 * confiança, por SDR, evolução mensal e canais), insights da carteira no
 * dashboard e distribuição automática do pool (o worker recalcula e
 * distribui). Dados fictícios; o SDR é convidado só para esta fase. Com
 * E2E_SCREENSHOT_DIR, guarda capturas das telas.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const SDR11 = {
  name: 'Sara Distribuição',
  email: 'sara.fase11@e2e.example',
  password: 'sdr-fase11-senha-forte-do-teste',
};

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: (path: string) => page.request.get(`/api/v1${path}`),
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
    put: (path: string, data: unknown = {}) =>
      page.request.put(`/api/v1${path}`, { data, headers }),
  };
}

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function sobralCode(page: Page) {
  return (await api(page).json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
}

async function eventSourceId(page: Page) {
  const sources = await api(page).json<{ data: { key: string; id: string }[] }>('/lead-sources');
  return sources.data.find((s) => s.key === 'EVENT')!.id;
}

test('gestão vê conversão, desempenho por SDR, evolução mensal e canais', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);

  // O worker recalcula os indicadores do período (como faz de hora em hora).
  const requested = await a.post('/analytics/rollup', { from: isoDay(-60), to: isoDay() });
  expect(requested.status()).toBe(202);
  await expect(async () => {
    const report = await a.json<{ freshness: { refreshedAt: string | null } }>(
      '/analytics/conversion?dimension=channel',
    );
    expect(report.freshness.refreshedAt).not.toBeNull();
  }).toPass({ timeout: 60_000 });

  await page.goto('/relatorios');
  await page
    .getByRole('navigation', { name: 'Relatórios' })
    .getByRole('link', { name: 'Conversão' })
    .click();
  await expect(page).toHaveURL(/\/relatorios\/conversao/);
  await expect(page.getByRole('heading', { name: 'Conversão por cidade' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Recorte' })
    .getByRole('link', { name: 'Canal do 1º contato' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Conversão por canal do 1º contato' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
  await expect(page.getByText(/intervalo de confiança de 95%/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/relatorio-conversao.png`, fullPage: true });

  // CSV auditado com o intervalo de cada taxa.
  const csv = await a.get('/analytics/performance-export?report=conversion&dimension=channel');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Canal do 1º contato;Primeiros contatos (coorte)');

  await page
    .getByRole('navigation', { name: 'Relatórios' })
    .getByRole('link', { name: 'Por SDR' })
    .click();
  // Títulos pelo papel: o anunciador de rotas do Next repete o título da página.
  await expect(page.getByRole('heading', { name: 'Desempenho por SDR' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Equipe', exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/relatorio-sdr.png`, fullPage: true });

  await page
    .getByRole('navigation', { name: 'Relatórios' })
    .getByRole('link', { name: 'Evolução mensal' })
    .click();
  await expect(page.getByRole('heading', { name: 'Mês a mês' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /\(parcial\)/ })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/relatorio-mensal.png`, fullPage: true });

  await page
    .getByRole('navigation', { name: 'Relatórios' })
    .getByRole('link', { name: 'Canais' })
    .click();
  await expect(page.getByRole('heading', { name: 'WhatsApp × Instagram' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Instagram', exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/relatorio-canais.png`, fullPage: true });
  assertNoCsp();
});

test('insights da carteira no dashboard: gerar agora e avaliar', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);

  // Um lead que respondeu e espera ação (fato "respostas esperando ação").
  const created = await a.post('/leads', {
    tradeName: 'Escritório Insight Fase 11',
    municipalityCode: await sobralCode(page),
    origin: { sourceId: await eventSourceId(page), collectedAt: isoDay(-5) },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '(88) 99711-1101', isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
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
        body: 'Pode me explicar melhor como funciona?',
      })
    ).status(),
  ).toBe(201);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Insights da equipe' })).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByText(/insights? gerados?\./)).toBeVisible();
  const list = page.getByRole('list', { name: 'Insights' });
  await expect(list).toContainText(/respond(eu|eram) e espera(m)? uma ação/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-insights.png`, fullPage: true });

  await list.getByRole('button', { name: 'Útil', exact: true }).first().click();
  await expect(page.getByText('Obrigado pela avaliação.')).toBeVisible();
  await expect(list.getByRole('button', { name: 'Útil', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  assertNoCsp();
});

test('distribuição automática: ligar, distribuir por território e registrar ausência', async ({
  page,
  browser,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const sobral = await sobralCode(page);

  // SDR fictício só desta fase, com Sobral como território.
  const invited = await a.post('/users', { name: SDR11.name, email: SDR11.email, role: 'SDR' });
  expect(invited.status()).toBe(201);
  const sdrId = ((await invited.json()) as { userId: string }).userId;
  const sdrContext = await browser.newContext({ baseURL });
  const sdrPage = await sdrContext.newPage();
  await sdrPage.goto(lastInviteLinkFor(SDR11.email));
  await setPassword(sdrPage, SDR11.password);
  await sdrPage.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(sdrPage).toHaveURL(/\/dashboard$/);
  await sdrContext.close();
  expect(
    (
      await a.put(`/users/${sdrId}/territories`, {
        territories: [{ stateUf: 'CE', municipalityCode: sobral }],
      })
    ).status(),
  ).toBe(200);

  await page.goto('/equipe/distribuicao');
  await expect(page.getByText('Desligada', { exact: true })).toBeVisible();
  await page.getByLabel('Distribuir automaticamente os leads sem responsável').check();
  await page.getByLabel('Por território (cidade, depois UF)').check();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Distribuição salva e ligada')).toBeVisible();
  await expect(page.getByText('Ligada', { exact: true })).toBeVisible();

  // Lead novo no pool, em Sobral: vai para quem cobre a cidade.
  const created = await a.post('/leads', {
    tradeName: 'Escritório Pool Fase 11',
    municipalityCode: sobral,
    origin: { sourceId: await eventSourceId(page), collectedAt: isoDay() },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '(88) 99711-1102', isWhatsapp: true }],
    ownerId: null,
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  const leadId = ((await created.json()) as { id: string }).id;
  await page.getByRole('button', { name: 'Distribuir agora' }).click();
  await expect(page.getByText('Distribuição pedida')).toBeVisible();
  await expect(async () => {
    const lead = await a.json<{ ownerId: string | null }>(`/leads/${leadId}`);
    expect(lead.ownerId).toBe(sdrId);
  }).toPass({ timeout: 60_000 });

  // Ausência: a pessoa fica fora até amanhã (inclusive).
  await page.reload();
  await expect(page.getByText(/leads distribuídos/)).toBeVisible();
  await page.getByLabel(`${SDR11.name} ausente até`).fill(isoDay(1));
  await page.getByRole('button', { name: `Salvar disponibilidade de ${SDR11.name}` }).click();
  await expect(page.getByText(`Disponibilidade de ${SDR11.name} salva.`)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(SDR11.name) });
  await expect(row.getByText('Fora', { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/distribuicao.png`, fullPage: true });

  // Desliga de novo (não interfere nos demais testes).
  await page.getByLabel('Distribuir automaticamente os leads sem responsável').uncheck();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Distribuição salva (desligada).')).toBeVisible();
  assertNoCsp();
});
