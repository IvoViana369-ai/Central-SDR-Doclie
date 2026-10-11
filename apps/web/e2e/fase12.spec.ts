import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, signIn, watchCsp } from './helpers';

/**
 * Fase 12: Integrações Docline. Chave de API criada na tela e usada com
 * Bearer (escopos, referência externa, ficha para o CRM, revogação); webhook
 * de saída para um receptor local (assinatura conferida, teste e opt-out
 * compartilhado); reunião na agenda (.ics e Google Agenda). Dados fictícios.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

async function eventSourceId(page: Page) {
  const sources = await api(page).json<{ data: { key: string; id: string }[] }>('/lead-sources');
  return sources.data.find((s) => s.key === 'EVENT')!.id;
}

async function sobralCode(page: Page) {
  return (await api(page).json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
}

async function newLead(page: Page, name: string, phone: string) {
  const created = await api(page).post('/leads', {
    tradeName: name,
    municipalityCode: await sobralCode(page),
    origin: { sourceId: await eventSourceId(page), collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: phone, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function openIntegrations(page: Page) {
  await page.goto('/configuracoes');
  await page.getByRole('link', { name: /Integrações Docline/ }).click();
  await expect(page.getByRole('heading', { name: 'Integrações Docline' })).toBeVisible();
}

test('chave de API: criar na tela, usar com Bearer e revogar', async ({ page, playwright }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await openIntegrations(page);

  await page.getByLabel('Nome da chave').fill('CRM Fase 12');
  await page.getByLabel('Sistema', { exact: true }).first().selectOption('DOCLINE_CRM');
  await page.getByRole('checkbox', { name: /Ler leads e oportunidades/ }).check();
  await page.getByRole('checkbox', { name: /Gravar referências externas/ }).check();
  await page.getByRole('button', { name: 'Criar chave' }).click();
  await expect(page.getByText('Chave criada.')).toBeVisible();
  const key = (await page.getByTestId('secret').textContent())!.trim();
  expect(key).toMatch(/^dsdr_/);
  const row = page.getByRole('row', { name: /CRM Fase 12/ });
  await expect(row.getByText('Ativa', { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/integracoes-chave.png`, fullPage: true });

  // Outro sistema: sem cookie, só a chave.
  const crm = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  });
  const ping = await crm.get('/api/v1/integrations/ping');
  expect(ping.status()).toBe(200);
  expect(((await ping.json()) as { key: { scopes: string[] } }).key.scopes).toEqual([
    'leads:read',
    'references:write',
  ]);
  // Rota da equipe não aceita chave; escopo que a chave não tem é negado.
  expect((await crm.get('/api/v1/lead-sources')).status()).toBe(401);
  const check = await crm.post('/api/v1/integrations/suppressions/check', {
    data: { identifiers: [{ type: 'PHONE', value: '(88) 99766-0001' }] },
  });
  expect(check.status()).toBe(403);

  // O CRM vincula o lead ao id dele e lê a ficha (só lead vinculado ou transferido).
  const leadId = await newLead(page, 'Escritório Fictício Fase 12', '(88) 99766-0002');
  expect((await crm.get(`/api/v1/integrations/leads/${leadId}`)).status()).toBe(404);
  const linked = await crm.put('/api/v1/integrations/references', {
    data: { entityType: 'LEAD', entityId: leadId, externalId: 'CRM-F12-1' },
  });
  expect(linked.status()).toBe(200);
  const ficha = await crm.get(`/api/v1/integrations/leads/${leadId}`);
  expect(ficha.status()).toBe(200);
  expect(await ficha.json()).toMatchObject({
    displayName: 'Escritório Fictício Fase 12',
    references: [{ system: 'DOCLINE_CRM', externalId: 'CRM-F12-1' }],
  });

  await page.goto(`/leads/${leadId}`);
  const refs = page.getByRole('list', { name: 'Referências externas' });
  await expect(refs).toContainText('CRM Docline:');
  await expect(refs).toContainText('CRM-F12-1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lead-referencias.png`, fullPage: true });

  // Revogação na tela: a próxima chamada já recebe 401.
  await openIntegrations(page);
  page.once('dialog', (dialog) => void dialog.accept('Fim do teste da Fase 12'));
  await page.getByRole('button', { name: 'Revogar CRM Fase 12' }).click();
  await expect(page.getByText('Chave “CRM Fase 12” revogada.')).toBeVisible();
  await expect(
    page.getByRole('row', { name: /CRM Fase 12/ }).getByText('Revogada', { exact: true }),
  ).toBeVisible();
  expect((await crm.get('/api/v1/integrations/ping')).status()).toBe(401);
  await crm.dispose();
  assertNoCsp();
});

test('webhook de saída: teste assinado e opt-out compartilhado', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  // Receptor fictício do "CRM", na própria máquina (liberado só em testes).
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  try {
    await signIn(page, ADMIN.email, ADMIN.password);
    await openIntegrations(page);
    await page.getByLabel('Nome do destino').fill('CRM receptor E2E');
    await page.getByLabel('URL do destino').fill(hookUrl);
    await page.getByRole('checkbox', { name: /Opt-out registrado/ }).check();
    await page.getByRole('button', { name: 'Cadastrar destino' }).click();
    await expect(page.getByText('Destino cadastrado.')).toBeVisible();
    const secret = (await page.getByTestId('secret').textContent())!.trim();
    expect(secret).toMatch(/^whsec_/);

    await page.getByRole('button', { name: 'Enviar teste para CRM receptor E2E' }).click();
    await expect(page.getByText(/Teste na fila/)).toBeVisible();
    await expect(() =>
      expect(received.some((r) => r.headers['docline-event'] === 'webhook.test')).toBe(true),
    ).toPass({ timeout: 60_000 });

    // Assinatura: HMAC-SHA256 de "timestamp.corpo" com o segredo do destino.
    const test = received.find((r) => r.headers['docline-event'] === 'webhook.test')!;
    const [t, v1] = String(test.headers['docline-signature'])
      .split(',')
      .map((part) => part.split('=')[1]!);
    expect(createHmac('sha256', secret).update(`${t}.${test.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(test.body)).toMatchObject({ type: 'webhook.test', apiVersion: '2026-10-14' });

    // Opt-out na ficha → o "CRM" recebe, com o lead e o valor mascarado.
    const leadId = await newLead(page, 'Escritório Fictício Opt-out F12', '(88) 99766-0003');
    expect((await api(page).post(`/leads/${leadId}/opt-out`, {})).status()).toBe(200);
    await expect(() =>
      expect(received.some((r) => r.headers['docline-event'] === 'optout.registered')).toBe(true),
    ).toPass({ timeout: 60_000 });
    const optOut = received.find((r) => r.headers['docline-event'] === 'optout.registered')!;
    const payload = JSON.parse(optOut.body) as {
      data: { leads: { id: string }[]; suppressions: { type: string }[] };
    };
    expect(payload.data.leads.map((l) => l.id)).toEqual([leadId]);
    expect(optOut.body).not.toContain('99766-0003');

    await page.reload();
    const deliveries = page.getByRole('table', { name: 'Entregas de webhook' });
    await expect(deliveries.getByText('Opt-out registrado')).toBeVisible();
    await expect(deliveries.getByText('Entregue').first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/integracoes-webhooks.png`, fullPage: true });

    // Pausa o destino (não interfere nas outras fases).
    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByText('Destino pausado.')).toBeVisible();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assertNoCsp();
});

test('reunião na agenda: .ics e Google Agenda pela ficha', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const leadId = await newLead(page, 'Escritório Fictício Agenda F12', '(88) 99766-0004');
  await page.goto(`/leads/${leadId}`);
  await page.getByLabel('Tipo da nova tarefa').selectOption('MEETING');
  await page.getByLabel('Nova tarefa', { exact: true }).fill('Apresentação Fase 12');
  await page.getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByText('Reunião agendada.')).toBeVisible();

  const ics = page.getByRole('link', { name: 'Arquivo .ics' });
  const google = page.getByRole('link', { name: 'Google Agenda' });
  await expect(ics).toBeVisible();
  await expect(google).toBeVisible();
  const file = await page.request.get((await ics.getAttribute('href'))!);
  expect(file.headers()['content-type']).toContain('text/calendar');
  const text = (await file.text()).replace(/\r\n /g, '');
  expect(text).toContain('SUMMARY:Apresentação Fase 12 — Escritório Fictício Agenda F12');
  expect(text).not.toContain('99766');
  const redirect = await page.request.get((await google.getAttribute('href'))!, {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toMatch(
    /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lead-reuniao.png`, fullPage: true });
  assertNoCsp();
});
