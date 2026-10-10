import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, signIn } from './helpers';

/**
 * Fase 4: pipeline Kanban (M08) e lead scoring (M07), com o worker de verdade
 * para os recálculos. Dados fictícios; depende da suíte da Fase 1 (senha da
 * administradora já definida).
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 });

/** O worker recalcula o score em segundo plano. */
const WORKER_TIMEOUT = 30_000;
const LEAD = 'Kanban Aroeira Teste';

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
    patch: (path: string, data: unknown = {}) =>
      page.request.patch(`/api/v1${path}`, { data, headers }),
  };
}

const column = (page: Page, key: string) => page.locator(`section[data-stage-key="${key}"]`);
const card = (page: Page, name: string) => page.locator(`[data-lead-card="${name}"]`);

let leadId = '';

test('aceite M08: arrastar, lock otimista, motivo de perda e histórico com duração', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const sources = await a.get<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.get<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const created = await a.post('/leads', {
    tradeName: LEAD,
    municipalityCode: sobral,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'EVENT')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '(88) 99812-3420', isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  leadId = ((await created.json()) as { id: string }).id;

  // Todo lead entra em "Novo"; a busca isola o lead deste teste.
  await page.goto('/pipeline');
  await page.getByLabel('Buscar no pipeline').fill('Aroeira Teste');
  await expect(page.getByTestId('pipeline-total')).toContainText('1 leads no funil');
  await expect(column(page, 'NEW').getByTestId('stage-count')).toHaveText('1');
  await expect(card(page, LEAD)).toContainText('20 · Frio');

  // Arrastar entre etapas abertas.
  await card(page, LEAD).dragTo(column(page, 'TO_QUALIFY'));
  await expect(page.getByText(`${LEAD} → A qualificar.`)).toBeVisible();
  await expect(column(page, 'TO_QUALIFY').locator(`[data-lead-card="${LEAD}"]`)).toBeVisible();
  await expect(column(page, 'NEW').getByTestId('stage-count')).toHaveText('0');

  // Outra pessoa altera o lead: o próximo movimento é recusado e o card volta.
  const lead = await a.get<{ version: number }>(`/leads/${leadId}`);
  const edit = await a.patch(`/leads/${leadId}`, {
    version: lead.version,
    description: 'Alterado em outra aba (E2E).',
  });
  expect(edit.status()).toBe(200);
  await card(page, LEAD).dragTo(column(page, 'QUALIFIED'));
  await expect(page.getByText('Outra pessoa alterou este lead')).toBeVisible();
  await expect(column(page, 'TO_QUALIFY').locator(`[data-lead-card="${LEAD}"]`)).toBeVisible();
  await expect(column(page, 'QUALIFIED').getByTestId('stage-count')).toHaveText('0');

  // "Primeiro contato" só registrando o contato (gate), nunca movendo à mão.
  await page.getByRole('button', { name: `Mover ${LEAD}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Mover de etapa' });
  await expect(
    dialog.getByRole('option', { name: 'Primeiro contato — indisponível' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  // Perda exige motivo. Durante o arraste, os desfechos aparecem numa barra fixa
  // (a coluna "Descartado" fica no fim do quadro); a área só existe depois que o
  // arraste começa, então os passos do mouse são manuais.
  await card(page, LEAD).hover();
  await page.mouse.down();
  await page.mouse.move(400, 400, { steps: 5 });
  await page.locator('[data-drop-zone="DISCARDED"]').hover();
  await page.mouse.up();
  await expect(dialog.getByLabel('Nova etapa')).toHaveValue(/.+/);
  await expect(dialog.getByRole('button', { name: 'Mover' })).toBeDisabled();
  await dialog.getByLabel('Motivo da perda').selectOption({ label: 'Fora do perfil' });
  await dialog.getByRole('button', { name: 'Mover' }).click();
  await expect(page.getByText(`${LEAD} → Descartado.`)).toBeVisible();
  await expect(column(page, 'DISCARDED').locator(`[data-lead-card="${LEAD}"]`)).toBeVisible();

  // Na ficha: etapa atual, motivo e o histórico com a duração de cada passagem.
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByTestId('lead-stage')).toContainText('Descartado');
  await expect(page.getByText('Motivo: Fora do perfil').first()).toBeVisible();
  await page.getByText('Histórico de etapas (3)').click();
  const history = page.getByRole('list', { name: 'Histórico de etapas' }).getByRole('listitem');
  await expect(history).toHaveCount(3);
  await expect(history.nth(0)).toContainText('até agora');
  await expect(history.nth(1)).toContainText('A qualificar');
  await expect(history.nth(2)).toContainText('Novo');

  // Auditoria da movimentação.
  const audit = await a.get<{ data: { entityId: string }[] }>(
    '/audit-logs?action=lead.stage_change',
  );
  expect(audit.data.filter((e) => e.entityId === leadId)).toHaveLength(2);
});

test('aceite M07: score explicado, cidade prioritária e nova versão do modelo', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const scoreOf = async () => (await a.get<{ score: number }>(`/leads/${leadId}/score`)).score;

  // Explicação por critério na ficha.
  await page.goto(`/leads/${leadId}`);
  const criteria = page.getByRole('list', { name: 'Critérios do score' });
  await expect(criteria.getByRole('listitem').filter({ hasText: 'Tem WhatsApp' })).toContainText(
    '+20',
  );
  await expect(
    criteria.getByRole('listitem').filter({ hasText: 'Em cidade prioritária' }),
  ).toContainText('0 de +15');

  // Cidade prioritária: o worker recalcula os leads da cidade.
  await page.goto('/configuracoes/cidades-prioritarias');
  await page.getByLabel('Cidade', { exact: true }).fill('Sobral');
  await page.getByRole('option', { name: /Sobral/ }).click();
  await page.getByRole('button', { name: 'Incluir' }).click();
  await expect(page.getByRole('row', { name: /Sobral\/CE/ })).toBeVisible();
  await expect.poll(scoreOf, { timeout: WORKER_TIMEOUT }).toBe(35);
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByText('35 · Morno').first()).toBeVisible();
  await page.getByText(/^Mudanças do score/).click();
  await expect(page.getByRole('list', { name: 'Histórico do score' })).toContainText(
    '20 → 35 (Morno) · Cidade incluída nas prioritárias',
  );

  // Nova versão: rascunho, simulação e ativação (a base é recalculada no worker).
  page.on('dialog', (d) => void d.accept());
  await page.goto('/configuracoes/score');
  await page.getByRole('button', { name: 'Criar rascunho para ajustar os pesos' }).click();
  await expect(page.getByText('Rascunho v2')).toBeVisible();
  await expect(page.getByLabel('Critério 1', { exact: true })).toHaveValue('has_whatsapp');
  await page.getByLabel('Pontos do critério 1').fill('50');
  await page.getByRole('button', { name: 'Simular impacto' }).click();
  await expect(page.getByText(/leads ativos mudam de faixa/)).toBeVisible();
  await page.getByRole('button', { name: 'Ativar versão' }).click();
  await expect(page.getByText('Versão 2 ativada.')).toBeVisible();
  await expect(page.getByText('Modelo ativo: v2')).toBeVisible();
  await expect.poll(scoreOf, { timeout: WORKER_TIMEOUT }).toBe(65);
});

test('no celular, o pipeline vira uma lista por etapa com o botão de mover', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/pipeline');
  await page.getByLabel('Buscar no pipeline').fill('Aroeira Teste');
  await expect(page.getByTestId('pipeline-total')).toContainText('1 leads no funil');
  await page.getByLabel('Etapa', { exact: true }).selectOption({ label: 'Descartado (1)' });
  await expect(card(page, LEAD)).toBeVisible();
  await page.getByRole('button', { name: `Mover ${LEAD}` }).click();
  await expect(page.getByRole('dialog', { name: 'Mover de etapa' })).toBeVisible();
});
