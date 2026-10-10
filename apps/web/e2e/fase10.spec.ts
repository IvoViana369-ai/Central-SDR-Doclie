import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, lastInviteLinkFor, setPassword, signIn, watchCsp } from './helpers';

/**
 * Fase 10: campanha montada a partir do filtro da lista de leads, com motivos
 * de inelegibilidade, teste A/B de duas abordagens e liberação diária para a
 * cadência (o worker monta e libera). A campanha não envia mensagens: o SDR
 * recebe as tarefas na Minha Fila. Dados fictícios; o SDR é convidado só
 * para esta fase. Com E2E_SCREENSHOT_DIR, guarda capturas das telas.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const SDR10 = {
  name: 'Davi Campanha',
  email: 'davi.fase10@e2e.example',
  password: 'sdr-fase10-senha-forte-do-teste',
};
const CAMPAIGN = 'Sobral — parceria (E2E)';
const TAG = 'campanha-e2e';

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

let campaignUrl = '';

test('gestão monta e ativa uma campanha com A/B; o lote do dia vai para a cadência', async ({
  page,
  browser,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);

  // SDR fictício só desta fase.
  const invited = await a.post('/users', { name: SDR10.name, email: SDR10.email, role: 'SDR' });
  expect(invited.status()).toBe(201);
  const sdrContext = await browser.newContext({ baseURL });
  const sdrPage = await sdrContext.newPage();
  await sdrPage.goto(lastInviteLinkFor(SDR10.email));
  await setPassword(sdrPage, SDR10.password);
  await sdrPage.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(sdrPage).toHaveURL(/\/dashboard$/);
  await sdrContext.close();

  // Tag, duas abordagens e quatro leads fictícios (um deles pede para sair).
  const tag = (await (await a.post('/tags', { name: TAG, color: 'teal' })).json()) as {
    id: string;
  };
  for (const [key, name] of [
    ['E2E_PARCERIA', 'Parceria (E2E)'],
    ['E2E_TEMPO', 'Economia de tempo (E2E)'],
  ]) {
    expect((await a.post('/approaches', { key, name })).status()).toBe(201);
  }
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const ids: string[] = [];
  for (const [index, name] of ['Alfa', 'Beta', 'Gama', 'Delta'].entries()) {
    const created = await a.post('/leads', {
      tradeName: `Escritório ${name} Campanha`,
      municipalityCode: sobral,
      origin: {
        sourceId: sources.data.find((s) => s.key === 'EVENT')!.id,
        collectedAt: '2026-10-01',
      },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'PHONE', value: `(88) 99710-100${index}`, isWhatsapp: true }],
      tagIds: [tag.id],
      acknowledgeDuplicates: true,
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }
  expect((await a.post(`/leads/${ids[3]}/opt-out`, {})).status()).toBe(200);

  // Da lista de leads, com o filtro da tag, para a nova campanha.
  await page.goto('/leads');
  await page.getByLabel('Tag', { exact: true }).selectOption({ label: TAG });
  await expect(page.getByTestId('lead-count')).toContainText('4 leads · 3 contactáveis');
  await page.getByRole('link', { name: 'Campanha com este filtro' }).click();
  await expect(page).toHaveURL(/\/campanhas\/nova\?selecao=/);
  await expect(page.getByText('Hoje: 4 leads · 3 contactáveis')).toBeVisible();
  await page.getByLabel('Nome', { exact: true }).fill(CAMPAIGN);
  await page.getByLabel('Leads por SDR por dia').fill('2');
  await page.getByLabel(SDR10.name).check();
  await page.getByRole('button', { name: 'Adicionar abordagem' }).click();
  await page.getByLabel('Abordagem da variante A').selectOption({ label: 'Parceria (E2E)' });
  await page.getByRole('button', { name: 'Adicionar abordagem' }).click();
  await page
    .getByLabel('Abordagem da variante B')
    .selectOption({ label: 'Economia de tempo (E2E)' });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campanha-nova.png`, fullPage: true });
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page).toHaveURL(/\/campanhas\/[0-9a-f-]+$/);
  campaignUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { name: CAMPAIGN })).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible();

  // Montar: retrato, motivos e distribuição (o worker faz em segundo plano).
  await page.getByRole('button', { name: 'Montar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Montar' }).click();
  await expect(page.getByText('Pronta para ativar')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('campaign-selected')).toContainText('4');
  await expect(page.getByTestId('campaign-eligible')).toContainText('3');
  await expect(page.getByTestId('campaign-skipped')).toContainText('1');
  // Distribuição antes de liberar: os 3 aptos com o único SDR.
  await expect(page.getByTestId('campaign-sdr-row')).toContainText(SDR10.name);
  await expect(page.getByRole('list', { name: 'Motivos de inelegibilidade' })).toContainText(
    'Na Lista Não Contatar',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campanha-pronta.png`, fullPage: true });

  // Ativar: o lote do dia (2 por SDR) entra na cadência; o resto aguarda.
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('não envia mensagens');
  await page.getByRole('dialog').getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('campaign-sdr-row')).toContainText('2/2', { timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId('campaign-released')).toContainText('2');
  await expect(page.getByTestId('campaign-pending')).toContainText('1');
  await expect(page.getByText('Teste A/B de abordagens')).toBeVisible();
  await expect(page.getByText(/Amostra pequena/).first()).toBeVisible();

  // Os leads da campanha: liberados e o que não passou, com o motivo.
  await page.getByLabel('Situação', { exact: true }).selectOption({ label: 'Não liberado' });
  await expect(page.getByRole('row', { name: /Escritório Delta Campanha/ })).toContainText(
    'Na Lista Não Contatar',
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campanha-ativa.png`, fullPage: true });

  // A campanha não envia nada: nenhum lead liberado tem mensagem.
  const released = await a.json<{ items: { leadId: string }[] }>(
    `${campaignUrl.replace('/campanhas', '/campaigns')}/leads?status=RELEASED`,
  );
  expect(released.items).toHaveLength(2);
  for (const { leadId } of released.items) {
    const messages = await a.json<{ data: unknown[] }>(`/leads/${leadId}/messages`);
    expect(messages.data).toHaveLength(0);
  }
  assertNoCsp();
});

test('SDR recebe o lead na Minha Fila com a abordagem sorteada; Campanhas é da gestão', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, SDR10.email, SDR10.password);
  await expect(page.getByRole('link', { name: 'Campanhas' })).toHaveCount(0);

  await page.goto('/fila');
  const items = page.getByTestId('queue-item').filter({ hasText: `Campanha: ${CAMPAIGN}` });
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('abordagem');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campanha-fila.png`, fullPage: true });

  await items.first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByText('Abordagem sugerida:')).toBeVisible();
  await expect(page.getByText(/variante [AB] do teste A\/B/)).toBeVisible();

  await page.goto(campaignUrl);
  await expect(page.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
  const denied = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Não pode' },
    headers: { origin: baseURL },
  });
  expect(denied.status()).toBe(403);
  assertNoCsp();
});
