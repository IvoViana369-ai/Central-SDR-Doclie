import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { baseURL, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN } from '../playwright.config';
import { ADMIN, signIn, watchCsp } from './helpers';

/**
 * Fase 7: WhatsApp pela API com o provedor simulado (nada sai do servidor).
 * Os webhooks são montados no formato da Meta e assinados com o app secret de
 * teste, como a Meta faria. Números e textos fictícios. Com E2E_SCREENSHOT_DIR,
 * guarda capturas das telas (revisão visual).
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const PHONE = '(88) 99812-7701';
/** wa_id de conta antiga, sem o 9º dígito (F7-06). */
const WA_ID = '558898127701';
const UNKNOWN_WA_ID = '5585999997702';

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    json: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

/** Webhook assinado como a Meta assina (HMAC-SHA256 do corpo com o app secret). */
async function webhook(page: Page, value: object, field = 'messages') {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'e2e', changes: [{ field, value }] }],
  });
  const signature = `sha256=${createHmac('sha256', META_APP_SECRET).update(body).digest('hex')}`;
  return page.request.post('/api/webhooks/whatsapp', {
    data: body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  });
}

const now = () => String(Math.floor(Date.now() / 1000));
const inbound = (from: string, id: string, text: string) => ({
  messaging_product: 'whatsapp',
  metadata: { phone_number_id: 'e2e' },
  contacts: [{ wa_id: from, profile: { name: 'Contato Fictício' } }],
  messages: [{ from, id, timestamp: now(), type: 'text', text: { body: text } }],
});

interface LeadWhatsapp {
  messages: { id: string; direction: string; status: string; body: string | null }[];
}

let leadId = '';

test('webhook: verificação do endpoint, assinatura obrigatória; modelos e número na configuração', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  const challenge = (token: string) =>
    page.request.get(
      `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`,
    );
  const ok = await challenge(META_WEBHOOK_VERIFY_TOKEN);
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe('4242');
  expect((await challenge('token-errado')).status()).toBe(403);
  const forged = await page.request.post('/api/webhooks/whatsapp', {
    data: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
    },
  });
  expect(forged.status()).toBe(401);

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar com a Meta' }).click();
  await expect(page.getByText(/Modelos sincronizados: 5 novos/)).toBeVisible();
  const apresentacao = page
    .getByTestId('whatsapp-template')
    .filter({ hasText: 'apresentacao_parceria' });
  await expect(apresentacao).toContainText('Aprovado');
  await expect(
    page.getByTestId('whatsapp-template').filter({ hasText: 'convite_evento_imagem' }),
  ).toContainText('Cabeçalho com mídia');
  await page.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(page.getByText('Situação atualizada.')).toBeVisible();
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/configuracoes-whatsapp.png`, fullPage: true });
  assertNoCsp();
});

test('opt-in do número, modelo aprovado e status pelo webhook (enviada, entregue, lida)', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  const me = await a.json<{ id: string }>('/me');
  const sources = await a.json<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.json<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const created = await a.post('/leads', {
    tradeName: 'Escritório Zap Fictício',
    municipalityCode: sobral,
    ownerId: me.id,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'GOOGLE')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: PHONE, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  leadId = ((await created.json()) as { id: string }).id;

  await page.goto(`/leads/${leadId}`);
  const card = page.getByTestId('whatsapp-card');
  await expect(card).toContainText('Simulado');
  await expect(card).toContainText('Sem opt-in');
  await expect(card).toContainText('Nenhum número com opt-in registrado');

  await card.getByRole('button', { name: 'Registrar opt-in' }).click();
  await page.getByLabel('Como o opt-in foi obtido').selectOption('FORM');
  await page.getByLabel('Evidência').fill('Formulário do evento fictício de 10/10/2026');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(card.getByText('Opt-in registrado.')).toBeVisible();
  await expect(card).toContainText('Opt-in desde');

  // Fora da janela de 24 h: só modelo aprovado.
  const composer = card.getByTestId('whatsapp-composer');
  await expect(composer.getByRole('tab', { name: 'Mensagem' })).toBeDisabled();
  await composer.getByLabel('Modelo').selectOption({ label: 'apresentacao_parceria (Marketing)' });
  await composer.getByLabel('Variável 1').fill('Ana');
  await composer.getByLabel('Variável 2').fill('Sobral');
  await expect(composer.getByLabel('Prévia')).toContainText('Olá, Ana!');
  await composer.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  await expect(card.getByText('Mensagem na fila de envio.')).toBeVisible();
  // O worker envia (provedor simulado) e a seção se atualiza sozinha.
  const sent = card.getByTestId('whatsapp-message').filter({ hasText: 'Olá, Ana!' });
  await expect(sent).toContainText('Enviada', { timeout: 30_000 });

  const { messages } = await a.json<LeadWhatsapp>(`/leads/${leadId}/whatsapp`);
  const outbound = messages.find((m) => m.direction === 'OUTBOUND')!;
  // A Meta devolve o nosso id (biz_opaque_callback_data) nos status.
  const status = (s: string) => ({
    id: `wamid.e2e-${s}`,
    status: s,
    timestamp: now(),
    recipient_id: WA_ID,
    biz_opaque_callback_data: outbound.id,
    ...(s === 'delivered'
      ? {
          pricing: { billable: true, pricing_model: 'PMP', type: 'regular', category: 'marketing' },
        }
      : {}),
  });
  expect(
    (
      await webhook(page, {
        messaging_product: 'whatsapp',
        statuses: [status('delivered'), status('read')],
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => (await a.json<LeadWhatsapp>(`/leads/${leadId}/whatsapp`)).messages[0]?.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('READ');
  await page.reload();
  await expect(card.getByTestId('whatsapp-message').first()).toContainText('Lida');
  assertNoCsp();
});

test('resposta pelo WhatsApp: entra na ficha, abre a janela, texto livre e sugestão da IA', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const a = api(page);
  expect(
    (
      await webhook(page, inbound(WA_ID, 'wamid.e2e-resposta', 'Tenho interesse, pode me ligar?'))
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await a.json<LeadWhatsapp>(`/leads/${leadId}/whatsapp`)).messages.some(
          (m) => m.direction === 'INBOUND',
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.goto(`/leads/${leadId}`);
  const card = page.getByTestId('whatsapp-card');
  await expect(card.getByTestId('whatsapp-message').last()).toContainText(
    'Tenho interesse, pode me ligar?',
  );
  await expect(card).toContainText('Janela aberta até');
  const composer = card.getByTestId('whatsapp-composer');
  await composer.getByRole('tab', { name: 'Mensagem' }).click();
  await composer.getByRole('textbox', { name: 'Mensagem' }).fill('Claro! Ligo às 15h, combinado?');
  await composer.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  await expect(
    card.getByTestId('whatsapp-message').filter({ hasText: 'Ligo às 15h' }),
  ).toContainText('Enviada', { timeout: 30_000 });
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/ficha-whatsapp.png` });

  // A resposta aparece nas mensagens do lead, com a sugestão automática da IA (a pessoa decide).
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText(/Sugestão da IA:/).count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  await page.goto('/conversas?filtro=todas');
  await expect(
    page.getByTestId('conversation').filter({ hasText: 'Escritório Zap Fictício' }),
  ).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversas.png`, fullPage: true });
  assertNoCsp();
});

test('número sem lead para decidir; "Sair" pelo WhatsApp leva à Lista Não Contatar', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  expect(
    (
      await webhook(
        page,
        inbound(UNKNOWN_WA_ID, 'wamid.e2e-desconhecido', 'Quero conhecer a parceria'),
      )
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        await page.goto('/conversas?aba=sem-lead');
        return page.getByTestId('unmatched').count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  const unmatched = page.getByTestId('unmatched');
  await expect(unmatched).toContainText('+5585999997702');
  await expect(unmatched).toContainText('Quero conhecer a parceria');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversas-sem-lead.png`, fullPage: true });
  await unmatched.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByText('Mensagem descartada.')).toBeVisible();
  await expect(page.getByText('Nenhuma mensagem pendente.')).toBeVisible();

  expect((await webhook(page, inbound(WA_ID, 'wamid.e2e-sair', 'Sair'))).status()).toBe(200);
  const a = api(page);
  await expect
    .poll(async () => (await a.json<{ contactStatus: string }>(`/leads/${leadId}`)).contactStatus, {
      timeout: 30_000,
    })
    .toBe('OPTED_OUT');
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByTestId('whatsapp-card')).toContainText('Lista Não Contatar');
  assertNoCsp();
});
