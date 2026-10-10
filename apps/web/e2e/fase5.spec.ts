import { expect, test, type Page } from '@playwright/test';
import { baseURL } from '../playwright.config';
import { ADMIN, signIn, watchCsp } from './helpers';

/**
 * Fase 5: Minha Fila (M10), cadência e follow-up (M11), contato assistido
 * (M13), opt-out na resposta (M14) e transferência ao Comercial (M15). Dados
 * fictícios; a janela de contato fica aberta o dia todo (e2e/prepare.mjs) e a
 * administradora faz os papéis de SDR e de comercial.
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const LEAD = 'Escritório Fila Teste';
const PHONE_DIGITS = '5588998125501';
const OPPORTUNITY_LEAD = 'Escritório Oportunidade Teste';
const BODY = 'Olá! Sou da Docline. Posso apresentar a parceria? Se não quiser, responda SAIR.';

function api(page: Page) {
  const headers = { origin: baseURL };
  return {
    get: async <T>(path: string) => (await (await page.request.get(`/api/v1${path}`)).json()) as T,
    post: (path: string, data: unknown = {}) =>
      page.request.post(`/api/v1${path}`, { data, headers }),
  };
}

/** Lead fictício da própria administradora, com WhatsApp e base legal. */
async function createOwnLead(page: Page, tradeName: string, phone: string): Promise<string> {
  const a = api(page);
  const me = await a.get<{ id: string }>('/me');
  const sources = await a.get<{ data: { key: string; id: string }[] }>('/lead-sources');
  const sobral = (await a.get<{ data: { ibgeCode: number }[] }>('/municipalities?q=sobral&uf=CE'))
    .data[0]!.ibgeCode;
  const created = await a.post('/leads', {
    tradeName,
    municipalityCode: sobral,
    ownerId: me.id,
    origin: {
      sourceId: sources.data.find((s) => s.key === 'EVENT')!.id,
      collectedAt: '2026-10-01',
    },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: phone, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

let leadId = '';

test('aceite M10/M11/M13: cadência gera a tarefa, a fila mostra e o contato assistido registra o envio', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  leadId = await createOwnLead(page, LEAD, '(88) 99812-5501');

  // Inscrever na cadência padrão: o primeiro passo vira tarefa (M11).
  await page.goto(`/leads/${leadId}`);
  await page.getByRole('button', { name: 'Inscrever na cadência' }).click();
  await expect(page.getByText('Lead inscrito na cadência.')).toBeVisible();
  const openTasks = page.getByRole('list', { name: 'Tarefas abertas' });
  await expect(openTasks).toContainText('Primeiro contato — Padrão — Contabilidade');
  await expect(page.getByTestId('lead-stage')).toContainText('Aguardando prospecção');

  // Minha Fila (M10): o passo aparece com a ação de contatar.
  await page.goto('/fila');
  await expect(page.getByRole('heading', { name: 'Minha Fila' })).toBeVisible();
  const item = page.getByTestId('queue-item').filter({ hasText: LEAD });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Primeiro contato');
  await item.getByRole('button', { name: 'Contatar' }).click();

  // Contato assistido (M13): o gate libera, o link abre o WhatsApp com o texto
  // e o envio só conta depois da confirmação.
  const dialog = page.getByRole('dialog', { name: 'Enviar mensagem' });
  await expect(dialog).toContainText('Para: (88) 99812-5501');
  await dialog.getByLabel('Mensagem', { exact: true }).fill(BODY);
  await dialog.getByRole('button', { name: 'Preparar envio' }).click();
  const confirm = page.getByRole('dialog', { name: 'Envie e confirme' });
  const whatsapp = confirm.getByRole('link', { name: 'Abrir no WhatsApp' });
  await expect(whatsapp).toHaveAttribute(
    'href',
    `https://wa.me/${PHONE_DIGITS}?text=${encodeURIComponent(BODY)}`,
  );
  await confirm.getByRole('button', { name: 'Confirmar envio' }).click();
  await expect(page.getByText('Envio registrado.')).toBeVisible();
  await expect(page.getByTestId('queue-item').filter({ hasText: LEAD })).toHaveCount(0);

  // Na ficha: etapa avançou, o próximo passo foi agendado e a timeline registra.
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByTestId('lead-stage')).toContainText('Primeiro contato');
  await expect(openTasks).toContainText('Follow-up 1 — Padrão — Contabilidade');
  await expect(page.getByTestId('message').first()).toContainText('WhatsApp · Enviada');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Mensagem enviada');

  // Follow-up avulso e reagendamento (M11).
  await page.getByLabel('Nova tarefa', { exact: true }).fill('Ligar para confirmar o interesse');
  await page.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(page.getByText('Follow-up agendado.')).toBeVisible();
  const manual = page.getByTestId('open-task').filter({ hasText: 'Ligar para confirmar' });
  await manual.getByRole('button', { name: 'Reagendar' }).click();
  const reschedule = page.getByRole('dialog', { name: 'Reagendar tarefa' });
  await reschedule.getByLabel('Nova data').fill('2026-12-01T10:00');
  await reschedule.getByRole('button', { name: 'Reagendar' }).click();
  await expect(page.getByText('Tarefa reagendada.')).toBeVisible();
  await expect(manual).toContainText('01/12/2026');
  assertNoCsp();
});

test('aceite M14: resposta com palavra de opt-out leva à Lista Não Contatar e encerra a cadência', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/leads/${leadId}`);
  await page.getByRole('button', { name: 'Registrar resposta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar resposta' });
  await dialog.getByLabel('O que o lead respondeu').fill('Sair');
  // O aviso aparece já ao digitar.
  await expect(dialog.getByText('Pedido de opt-out')).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar resposta' }).click();
  await expect(
    page.getByText('Resposta registrada. Pedido de opt-out: o lead entrou na Lista Não Contatar.'),
  ).toBeVisible();

  await expect(page.getByText('Lead na Lista Não Contatar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('lead-stage')).toContainText('Sem interesse');
  await expect(page.getByText('Fora de cadência.')).toBeVisible();
  await expect(page.getByText('Encerrada (Opt-out)')).toBeVisible();
  const contact = page.getByTestId('contact-point').first();
  await expect(contact.getByRole('button', { name: 'WhatsApp', exact: true })).toBeDisabled();
  await expect(page.getByTestId('message').first()).toContainText(
    'Pediu para não ser contatado (regra)',
  );

  // Tela Mensagens: a resposta aparece com a classificação da regra.
  await page.goto('/mensagens?view=replies');
  await expect(
    page.getByTestId('message').filter({ hasText: LEAD }).filter({ hasText: 'Sair' }),
  ).toContainText('Pediu para não ser contatado (regra)');

  // Conformidade: o número está na Lista Não Contatar.
  await page.goto('/conformidade');
  await page.getByLabel('Buscar na lista pelo valor').fill('88998125501');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('+55 88 9****-5501')).toBeVisible();
});

test('aceite M15: transferência com checklist, aviso ao comercial, aceite e ganho', async ({
  page,
}) => {
  const assertNoCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const id = await createOwnLead(page, OPPORTUNITY_LEAD, '(88) 99812-5502');
  await page.goto(`/leads/${id}`);

  await page.getByRole('button', { name: 'Transferir ao Comercial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transferir ao Comercial' });
  await dialog.getByLabel('Comercial responsável').selectOption({ label: 'Ana Administradora' });
  // Checklist obrigatório: sem ele, a transferência é recusada.
  await dialog.getByRole('button', { name: 'Transferir' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Informe o decisor');
  await dialog.getByLabel('Decisor (nome e função) *').fill('Sócia responsável (fictícia)');
  await dialog.getByLabel('Interesse declarado *').fill('Quer conhecer a parceria de revenda.');
  await dialog.getByLabel('Melhor canal e horário *').fill('WhatsApp, à tarde');
  await dialog.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByText('Lead transferido ao Comercial.')).toBeVisible();
  await expect(page.getByTestId('lead-stage')).toContainText('Oportunidade');
  const opportunity = page.getByTestId('opportunity');
  await expect(opportunity).toContainText('Aberta');
  await expect(opportunity).toContainText('Quer conhecer a parceria de revenda.');

  // O comercial recebe o aviso (sino) e a oportunidade na fila.
  await page.reload();
  await page.getByRole('button', { name: /^Avisos/ }).click();
  await expect(page.getByRole('list', { name: 'Lista de avisos' })).toContainText(
    `Nova oportunidade: ${OPPORTUNITY_LEAD}`,
  );
  await page.keyboard.press('Escape');
  await page.goto('/fila');
  const item = page.getByTestId('queue-item').filter({ hasText: OPPORTUNITY_LEAD });
  await expect(item).toContainText('Aguardando aceite');
  await item.getByRole('button', { name: 'Aceitar oportunidade' }).click();
  await expect(page.getByText('Oportunidade aceita.')).toBeVisible();

  // Ganha: o lead vira parceiro e vai para "Convertido".
  await page.goto(`/leads/${id}`);
  await expect(opportunity).toContainText('Aceita em');
  await opportunity.getByRole('button', { name: 'Ganha (parceiro)' }).click();
  await expect(page.getByText('Oportunidade ganha: lead convertido.')).toBeVisible();
  await expect(page.getByTestId('lead-stage')).toContainText('Convertido');
  await expect(opportunity).toContainText('Convertido como parceiro.');
  assertNoCsp();
});

test('configurações: cadência padrão e regras de contato (ADMIN)', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/configuracoes/cadencias');
  const cadence = page.getByTestId('cadence').filter({ hasText: 'Padrão — Contabilidade' });
  await expect(cadence).toContainText('Padrão');
  await expect(cadence.getByRole('list', { name: /Passos de/ })).toContainText('D0');
  await expect(cadence.getByRole('list', { name: /Passos de/ })).toContainText('D10');

  await page.goto('/configuracoes/contato');
  await expect(page.getByLabel('Palavras e frases')).toHaveValue(/sair/);
  await page.getByRole('button', { name: 'Salvar regras' }).click();
  await expect(page.getByText('Regras salvas.')).toBeVisible();
});
