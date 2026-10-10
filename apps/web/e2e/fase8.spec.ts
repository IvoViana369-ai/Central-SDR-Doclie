import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { baseURL, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN } from '../playwright.config';
import { ADMIN, signIn, watchCsp } from './helpers';

/**
 * Fase 8: Instagram pela API com o provedor simulado (nada sai do servidor).
 * Os webhooks são montados no formato da Meta e assinados com o app secret de
 * teste. O IGSID simulado sai do @ (`fake-igsid-<@>`). Perfis e textos
 * fictícios. Com E2E_SCREENSHOT_DIR, guarda capturas das telas.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const ACCOUNT = 'fake-ig-account';
const HANDLE = 'escritorio.insta.e2e';
const UNKNOWN_HANDLE = 'desconhecido.insta.e2e';
const igsid = (handle: string) => `fake-igsid-${handle}`;

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

/** Webhook assinado como a Meta assina (HMAC-SHA256 do corpo com o app secret). */
async function webhook(page: Page, content: object) {
  const body = JSON.stringify({
    object: 'instagram',
    entry: [{ id: ACCOUNT, time: Math.floor(Date.now() / 1000), ...content }],
  });
  const signature = `sha256=${createHmac('sha256', META_APP_SECRET).update(body).digest('hex')}`;
  return page.request.post('/api/webhooks/instagram', {
    data: body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  });
}

const dm = (handle: string, mid: string, text: string) => ({
  messaging: [
    {
      sender: { id: igsid(handle) },
      recipient: { id: ACCOUNT },
      timestamp: Date.now(),
      message: { mid, text },
    },
  ],
});
const comment = (handle: string, id: string, text: string) => ({
  changes: [
    {
      field: 'comments',
      value: {
        id,
        text,
        from: { id: igsid(handle), username: handle },
        media: { id: 'publicacao-e2e', media_product_type: 'FEED' },
      },
    },
  ],
});

interface LeadInstagram {
  messages: { direction: string; status: string; body: string | null }[];
  comments: { id: string }[];
}

let leadId = '';

test('webhook: verificação do endpoint, assinatura obrigatória; conta na configuração', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  const challenge = (token: string) =>
    page.request.get(
      `/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4343`,
    );
  const ok = await challenge(META_WEBHOOK_VERIFY_TOKEN);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe('4343');
  expect((await challenge('token-errado')).status()).toBe(403);
  const forged = await page.request.post('/api/webhooks/instagram', {
    data: JSON.stringify({ object: 'instagram', entry: [] }),
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
    },
  });
  expect(forged.status()).toBe(401);

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes/instagram');
  await expect(page.getByRole('heading', { name: 'Instagram', level: 1 })).toBeVisible();
  await expect(page.getByText('Simulado')).toBeVisible();
  await page.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(page.getByText('Situação atualizada.')).toBeVisible();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(page.getByText('@docline.demo')).toBeVisible();
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/configuracoes-instagram.png`, fullPage: true });
  assertNoCsp();
});

test('comentário de lead e resposta privada; métricas públicas do perfil', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const me = await a.json<{ id: string }>('/me');
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const created = await a.post('/leads', {
    tradeName: 'Escritório Insta Fictício',
    municipalityCode: sobral,
    ownerId: me.id,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'GOOGLE')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'INSTAGRAM', value: `@${HANDLE}` }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  leadId = ((await created.json()) as { id: string }).id;

  await page.goto(`/leads/${leadId}`);
  const card = page.getByTestId('instagram-card');
  await expect(card).toContainText('Simulado');
  await expect(card).toContainText(`@${HANDLE}`);
  // Sem mensagem do contato, a API não responde: o primeiro contato é pelo app.
  await expect(card).toContainText('nas últimas 24 h');
  await expect(card.getByTestId('instagram-composer')).toHaveCount(0);

  // Métricas públicas (Business Discovery simulado).
  await card.getByRole('button', { name: 'Atualizar métricas' }).click();
  await expect(card.getByText('Métricas do Instagram atualizadas.')).toBeVisible();
  await expect(card.getByTestId('instagram-metrics')).toContainText('seguidores');

  // Comentário numa publicação da Docline: entra na ficha, com a resposta privada.
  expect(
    (await webhook(page, comment(HANDLE, 'comentario-e2e-1', 'Que conteúdo bom!'))).status(),
  ).toBe(200);
  await expect
    .poll(async () => (await a.json<LeadInstagram>(`/leads/${leadId}/instagram`)).comments.length, {
      timeout: 30_000,
    })
    .toBe(1);
  await page.reload();
  const item = card.getByTestId('instagram-comment');
  await expect(item).toContainText('Que conteúdo bom!');
  await item.getByRole('button', { name: 'Responder em particular' }).click();
  await page.getByRole('textbox', { name: 'Mensagem' }).fill('Obrigado! Posso te contar mais?');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(card.getByText('Resposta privada na fila de envio.')).toBeVisible();
  // O worker envia (provedor simulado) e a seção se atualiza sozinha.
  await expect(item).toContainText('Resposta privada: Enviada', { timeout: 30_000 });
  await expect(item.getByRole('button', { name: 'Responder em particular' })).toHaveCount(0);
  assertNoCsp();
});

test('DM do lead: entra na ficha, abre a janela e a resposta sai pela API', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  expect(
    (await webhook(page, dm(HANDLE, 'mid.e2e-dm-1', 'Tenho interesse, como funciona?'))).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await a.json<LeadInstagram>(`/leads/${leadId}/instagram`)).messages.some(
          (m) => m.direction === 'INBOUND',
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.goto(`/leads/${leadId}`);
  const card = page.getByTestId('instagram-card');
  await expect(card.getByTestId('instagram-message').last()).toContainText(
    'Tenho interesse, como funciona?',
  );
  await expect(card).toContainText('Janela aberta até');
  const composer = card.getByTestId('instagram-composer');
  await composer.getByRole('textbox', { name: 'Resposta' }).fill('Te explico! Posso ligar às 15h?');
  await composer.getByRole('button', { name: 'Responder pelo Instagram' }).click();
  await expect(
    card.getByTestId('instagram-message').filter({ hasText: 'Posso ligar às 15h' }),
  ).toContainText('Enviada', { timeout: 30_000 });
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/ficha-instagram.png` });

  await page.goto('/conversas?canal=instagram&filtro=todas');
  await expect(
    page.getByTestId('conversation').filter({ hasText: 'Escritório Insta Fictício' }),
  ).toContainText(`@${HANDLE}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversas-instagram.png`, fullPage: true });
  assertNoCsp();
});

test('mensagem de quem não é lead: fica para decidir em Conversas', async ({ page }) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  expect(
    (
      await webhook(page, dm(UNKNOWN_HANDLE, 'mid.e2e-desconhecido', 'Quero saber da parceria'))
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        await page.goto('/conversas?canal=instagram&aba=sem-lead');
        return page.getByTestId('unmatched').count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  const unmatched = page.getByTestId('unmatched');
  await expect(unmatched).toContainText(`@${UNKNOWN_HANDLE}`);
  await expect(unmatched).toContainText('Quero saber da parceria');
  await unmatched.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByText('Mensagem descartada.')).toBeVisible();
  await expect(page.getByText('Nenhuma mensagem pendente.')).toBeVisible();
  // As mensagens do WhatsApp continuam na aba dele.
  await page.goto('/conversas?aba=sem-lead');
  await expect(page.getByRole('link', { name: 'Números sem lead' })).toBeVisible();
  assertNoCsp();
});
