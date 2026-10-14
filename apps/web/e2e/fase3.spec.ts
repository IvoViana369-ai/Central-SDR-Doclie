import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, signIn } from './helpers';

/**
 * Fase 3 com o worker de verdade: importação com prévia (M04), normalização na
 * prévia (M05) e revisão de duplicados (M06). Dados fictícios; depende da suíte
 * da Fase 1 (senha da administradora já definida).
 */
// Cada jornada espera o worker várias vezes (leitura, prévia e gravação, duas vezes).
test.describe.configure({ mode: 'serial', timeout: 90_000 });

/** O worker processa em segundo plano: as telas consultam o andamento. */
const WORKER_TIMEOUT = 30_000;

/** Planilha fictícia: título, cabeçalho na linha 2 e o mesmo celular em três formatos. */
const CSV = [
  'Lista fictícia de escritórios (E2E)',
  'Nome Escritório;Telefone comercial;E-mail;Município;UF;Funcionários',
  'Contábil Aurora Teste;(88) 99812-3401;contato@aurora-e2e.example;Sobral;CE;12',
  'Brisa Contadores Teste;(85) 99812-3402;;Fortaleza;CE;',
  'Cedro Assessoria Teste;88998123401;;Sobral;CE;',
  'Dália Escritório Teste;+55 88 99812-3401;;Sobral;CE;',
  ';(88) 97777-0005;;Sobral;CE;',
].join('\n');

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

async function uploadCsv(page: Page) {
  await page.goto('/importar');
  // Antes da hidratação o envio seria um submit nativo: repete até chegar ao lote.
  await expect(async () => {
    await page.getByLabel('Planilha').setInputFiles({
      name: 'escritorios-ficticios.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV, 'utf8'),
    });
    await page.getByRole('button', { name: 'Enviar e continuar' }).click();
    await expect(page).toHaveURL(/\/importar\/[0-9a-f-]{36}$/, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  // O worker lê o arquivo e a tela passa ao mapeamento.
  await expect(page.getByText('Colunas da planilha')).toBeVisible({ timeout: WORKER_TIMEOUT });
}

async function configure(page: Page) {
  await page.getByLabel('Origem', { exact: true }).selectOption({ label: 'Evento' });
  await page
    .getByLabel('Base legal', { exact: true })
    .selectOption({ label: 'Legítimo interesse' });
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(page.getByText('Nada foi gravado ainda.')).toBeVisible({ timeout: WORKER_TIMEOUT });
}

/** Contagem do cartão de uma situação na prévia. */
function statusCard(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^\\d+\\s*${label}$`) });
}

async function commit(page: Page, rows: number) {
  await page.getByRole('button', { name: `Importar ${rows} linhas` }).click();
  await page.getByRole('button', { name: 'Confirmar e gravar' }).click();
  await expect(page.getByText('Importação concluída')).toBeVisible({ timeout: WORKER_TIMEOUT });
}

/** Valor de um item do relatório final. */
function reportValue(page: Page, label: string) {
  return page.locator('dl > div').filter({ hasText: label }).locator('dd');
}

test('aceite M04/M05: prévia normalizada; reimportar avisa e não cria duplicados', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await uploadCsv(page);

  // Sugestão automática pelo nome da coluna (M04).
  await expect(page.getByLabel('Linha do cabeçalho')).toHaveValue('2');
  await expect(page.getByLabel('Destino da coluna Nome Escritório')).toHaveValue('tradeName');
  await expect(page.getByLabel('Destino da coluna Telefone comercial')).toHaveValue('phone');
  await expect(page.getByLabel('Destino da coluna Município')).toHaveValue('city');
  await expect(page.getByLabel('Destino da coluna Funcionários')).toHaveValue('custom');
  await configure(page);

  // O mesmo celular em três formatos é o mesmo contato (M05): as repetições são marcadas.
  await expect(statusCard(page, 'Novo')).toHaveAccessibleName(/^2/);
  await expect(statusCard(page, 'Repetido no arquivo')).toHaveAccessibleName(/^2/);
  await expect(statusCard(page, 'Inválido')).toHaveAccessibleName(/^1/);
  await expect(page.getByRole('row', { name: /Dália Escritório Teste/ })).toContainText(
    'Repetido no arquivo',
  );
  await commit(page, 2);
  await expect(reportValue(page, 'Leads criados')).toHaveText('2');

  // Mesmo arquivo de novo: aviso, tudo "já existe" e nenhum lead novo (aceite M04).
  await uploadCsv(page);
  await expect(page.getByText('Este arquivo já foi importado')).toBeVisible();
  await configure(page);
  await expect(statusCard(page, 'Já existe')).toHaveAccessibleName(/^2/);
  await expect(statusCard(page, 'Novo')).toHaveAccessibleName(/^0/);
  await commit(page, 2);
  await expect(reportValue(page, 'Leads criados')).toHaveText('0');
  await expect(reportValue(page, 'Origem registrada em lead existente')).toHaveText('2');

  const search = await api(page).post('/leads/search', { q: 'Aurora Teste' });
  const found = (await search.json()) as { data: { displayName: string }[] };
  expect(found.data.map((l) => l.displayName)).toEqual(['Contábil Aurora Teste']);
});

test('aceite M06: "manter separados" não volta; mesclar reúne tudo e não exclui', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const sources = await a.get<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sourceId = sources.data.find((s) => s.key === 'EVENT')!.id;
  const sobral = (await a.get<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const create = async (tradeName: string, contact: { type: string; value: string }) => {
    const response = await a.post('/leads', {
      tradeName,
      municipalityCode: sobral,
      origin: { sourceId, collectedAt: '2026-10-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [contact],
      acknowledgeDuplicates: true,
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  await create('Jatobá Teste', { type: 'EMAIL', value: 'contato@jatoba-e2e.example' });
  await create('Jacarandá Teste', { type: 'EMAIL', value: 'contato@jatoba-e2e.example' });
  await create('Escritório Ipê Teste', { type: 'PHONE', value: '(88) 99812-3410' });
  await create('Ipê Contabilidade Teste', { type: 'PHONE', value: '(88) 99812-3410' });

  // O worker procura duplicados de cada cadastro (dedup.check-lead).
  await expect
    .poll(
      async () =>
        (await a.get<{ data: { leads: { displayName: string }[] }[] }>('/duplicates')).data
          .flatMap((d) => d.leads.map((l) => l.displayName))
          .filter((name) => /Jatobá|Jacarandá|Ipê/.test(name)).length,
      { timeout: WORKER_TIMEOUT },
    )
    .toBe(4);

  // Manter separados: sai da fila e não volta nem com a varredura completa.
  await page.goto('/duplicados');
  await page
    .getByRole('row', { name: /Jatobá Teste/ })
    .getByRole('link', { name: 'Comparar' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^L-\d{6} × L-\d{6}$/);
  await expect(page.getByText('Confiança média')).toBeVisible();
  await page.getByRole('button', { name: 'Manter separados' }).click();
  await expect(page).toHaveURL(/\/duplicados$/);
  await expect(page.getByRole('row', { name: /Jatobá Teste/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Varrer a base agora' }).click();
  await expect(page.getByText('Varredura agendada')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await a.get<{ data: unknown[] }>('/audit-logs?action=duplicate.scan_completed')).data
          .length,
      { timeout: WORKER_TIMEOUT },
    )
    .toBeGreaterThan(0);
  const pending = await a.get<{ data: { leads: { displayName: string }[] }[] }>('/duplicates');
  expect(pending.data.some((d) => d.leads.some((l) => l.displayName === 'Jatobá Teste'))).toBe(
    false,
  );

  // Mesclar escolhendo o nome do outro lead.
  await page.reload();
  await page
    .getByRole('row', { name: /Ipê Contabilidade Teste/ })
    .getByRole('link', { name: 'Comparar' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^L-\d{6} × L-\d{6}$/);
  await page.getByLabel('Nome fantasia: Ipê Contabilidade Teste').check();
  await page.getByRole('button', { name: /^Mesclar em L-/ }).click();
  await page.getByRole('button', { name: 'Confirmar mesclagem' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Ipê Contabilidade Teste' })).toBeVisible();

  // O lead mesclado continua existindo, só para consulta, apontando para o que ficou.
  const audit = await a.get<{ data: { entityId: string }[] }>(
    '/audit-logs?action=lead.merged_into',
  );
  await page.goto(`/leads/${audit.data[0]!.entityId}`);
  await expect(page.getByText('Lead mesclado', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Este registro fica só para consulta; nada foi excluído.'),
  ).toBeVisible();
});
