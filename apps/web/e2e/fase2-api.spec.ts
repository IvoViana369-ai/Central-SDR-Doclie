import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, lastInviteLinkFor, signIn } from './helpers';

/**
 * API v1 da Fase 2 (leads e conformidade) com sessão real: proteção de origem,
 * problem+json, aviso de duplicidade, escopo por perfil e Lista Não Contatar.
 * Depende da suíte da Fase 1 (senha da administradora já definida).
 */
test.describe.configure({ mode: 'serial' });

const SDR2 = {
  name: 'Carla Prospectora',
  email: 'carla@e2e.example',
  password: 'girassol-trem-azul-nuvem',
};

/** Requisições que alteram estado precisam vir da própria aplicação (CSRF). */
function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: (path: string) => page.request.get(`/api/v1${path}`),
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
    patch: (path: string, data: unknown = {}) =>
      page.request.patch(`/api/v1${path}`, { data, headers }),
  };
}

/** Corpo JSON com o tipo esperado pelo teste. */
async function read<T>(response: APIResponse | Promise<APIResponse>): Promise<T> {
  return (await (await response).json()) as T;
}

type Item = Record<string, unknown>;
type List<T = Item> = { data: T[] };

let googleId: string;
let leadId: string;

test('cadastro pela API: origem e base legal obrigatórias; duplicidade vira 409 com a lista', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);

  const sources = await read<List<{ key: string; id: string }>>(a.get('/lead-sources'));
  googleId = sources.data.find((s) => s.key === 'GOOGLE')!.id;
  const sobral = (
    await read<List<{ ibgeCode: number; name: string }>>(a.get('/municipalities?q=sobral&uf=CE'))
  ).data[0]!;
  expect(sobral).toMatchObject({ name: 'Sobral', uf: 'CE', ddd: 88 });

  const invalid = await a.post('/leads', { tradeName: 'Sem origem' });
  expect(invalid.status()).toBe(422);
  expect(invalid.headers()['content-type']).toContain('application/problem+json');

  const body = {
    tradeName: 'Contábil API Fictícia',
    municipalityCode: sobral.ibgeCode,
    origin: { sourceId: googleId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '9 9999-7777', isWhatsapp: true }],
  };
  const created = await a.post('/leads', body);
  expect(created.status()).toBe(201);
  const lead = await read<{ id: string }>(created);
  leadId = lead.id;
  expect(lead).toMatchObject({ code: 'L-000001', contactStatus: 'CONTACTABLE' });

  const duplicate = await a.post('/leads', { ...body, tradeName: 'Outro nome' });
  expect(duplicate.status()).toBe(409);
  expect(await read<Item>(duplicate)).toMatchObject({
    code: 'POSSIBLE_DUPLICATE',
    title: 'Possível duplicado',
    duplicates: [
      {
        code: 'L-000001',
        reasons: [{ kind: 'PHONE', detail: 'mesmo telefone (+55 88 9****-7777)' }],
      },
    ],
  });

  const detail = await read<{ contactPoints: Item[] }>(a.get(`/leads/${leadId}`));
  expect(detail.contactPoints[0]).toMatchObject({
    display: '(88) 99999-7777',
    links: { whatsapp: 'https://wa.me/5588999997777' },
  });

  // Edição concorrente: versão antiga → 409.
  expect(
    (await a.patch(`/leads/${leadId}`, { version: 1, category: 'Contabilidade' })).status(),
  ).toBe(200);
  expect((await a.patch(`/leads/${leadId}`, { version: 1, category: 'Outra' })).status()).toBe(409);
});

test('requisição de outra origem é recusada (CSRF)', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const response = await page.request.post('/api/v1/leads/count', {
    data: {},
    headers: { origin: 'https://atacante.example' },
  });
  expect(response.status()).toBe(403);
});

test('lista, contagem e opt-out com gate de contactabilidade', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const search = await read<List<{ codeLabel: string }>>(
    a.post('/leads/search', { q: '(88) 99999-7777' }),
  );
  expect(search.data.map((l) => l.codeLabel)).toEqual(['L-000001']);
  expect(await read<Item>(a.post('/leads/count', {}))).toMatchObject({
    total: 1,
    contactable: 1,
  });

  const optOut = await a.post(`/leads/${leadId}/opt-out`, { scope: 'WHATSAPP' });
  expect(await read<Item>(optOut)).toMatchObject({ contactStatus: 'RESTRICTED' });
  const gate = await read<{ channels: Item[] }>(a.get(`/leads/${leadId}/contactability`));
  expect(gate.channels[0]).toMatchObject({ channel: 'WHATSAPP', allowed: false });
  expect(gate.channels[1]).toMatchObject({ channel: 'PHONE', allowed: true });

  // O opt-out de um canal suprime o telefone e o próprio lead naquele canal.
  const list = await read<List>(a.get('/suppressions'));
  expect(list.data.map((e) => e.type).sort()).toEqual(['LEAD', 'PHONE']);
  expect(list.data.find((e) => e.type === 'PHONE')).toMatchObject({
    type: 'PHONE',
    valueMasked: '+55 88 9****-7777',
    scope: 'WHATSAPP',
  });
});

test('SDR sem território não vê o lead do pool; a tentativa é auditada', async ({
  page,
  browser,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const invited = await api(page).post('/users', {
    name: SDR2.name,
    email: SDR2.email,
    role: 'SDR',
  });
  expect(invited.status()).toBe(201);

  const sdrContext = await browser.newContext({ baseURL });
  const sdrPage = await sdrContext.newPage();
  await sdrPage.goto(lastInviteLinkFor(SDR2.email));
  await sdrPage.getByLabel('Nova senha', { exact: true }).fill(SDR2.password);
  await sdrPage.getByLabel('Confirme a nova senha').fill(SDR2.password);
  await sdrPage.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(sdrPage).toHaveURL(/\/dashboard$/);

  const denied = await api(sdrPage).get(`/leads/${leadId}`);
  expect(denied.status()).toBe(404);
  expect((await read<{ total: number }>(api(sdrPage).post('/leads/count', {}))).total).toBe(0);
  // SDR não faz ações em massa nem consulta a Lista Não Contatar.
  expect(
    (
      await api(sdrPage).post('/leads/bulk', {
        action: 'addTag',
        target: { ids: [leadId] },
        params: {},
      })
    ).status(),
  ).toBe(403);
  expect((await api(sdrPage).get('/suppressions')).status()).toBe(403);
  await sdrContext.close();

  const audit = await read<List<{ entityType: string; entityId: string }>>(
    api(page).get('/audit-logs?action=access.denied'),
  );
  expect(audit.data.some((e) => e.entityType === 'lead' && e.entityId === leadId)).toBe(true);
});
