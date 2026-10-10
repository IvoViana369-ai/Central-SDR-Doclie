import { describe, expect, it } from 'vitest';
import { WhatsappProviderError } from '../../../ports/whatsapp';
import { FAKE_TEMPLATES, FakeWhatsappProvider } from '../infra/fake-provider';
import { describeWhatsappError, isRetryableWhatsappError } from './errors';
import { MetaWebhookFormatError, parseMetaWebhook, webhookContactIds } from './meta-webhook';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  estimateMessageCost,
  resolveWhatsappSettings,
} from './settings';
import {
  analyzeTemplate,
  orderedTemplateParams,
  renderTemplate,
  templateVariables,
  validateTemplateParams,
} from './templates';
import { nextDeliveryStatus, serviceWindow, serviceWindowExpiry } from './window';

/** Corpo de webhook da Meta (formato da Cloud API) com números fictícios. */
const webhook = (field: string, value: unknown) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '100000000000001', changes: [{ field, value }] }],
});

const ts = '1791892800'; // 2026-10-13T12:00:00Z

describe('webhook da Meta', () => {
  it('lê mensagens recebidas (texto, botão, lista, legenda) com o nome do perfil', () => {
    const events = parseMetaWebhook(
      webhook('messages', {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '5500000000000', phone_number_id: '200000000000002' },
        contacts: [{ wa_id: '558898120001', profile: { name: 'Contato Fictício' } }],
        messages: [
          {
            from: '558898120001',
            id: 'wamid.A',
            timestamp: ts,
            type: 'text',
            text: { body: 'Oi!' },
          },
          {
            from: '558898120001',
            id: 'wamid.B',
            timestamp: ts,
            type: 'button',
            button: { text: 'Quero saber mais', payload: 'p1' },
          },
          {
            from: '558898120001',
            id: 'wamid.C',
            timestamp: ts,
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'x', title: 'Terça' } },
          },
          {
            from: '558898120001',
            id: 'wamid.D',
            timestamp: ts,
            type: 'image',
            image: { id: 'media-1', caption: 'Nosso escritório' },
          },
          {
            from: '558898120001',
            id: 'wamid.E',
            timestamp: ts,
            type: 'audio',
            audio: { id: 'm2' },
          },
        ],
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: 'message',
        phoneNumberId: '200000000000002',
        providerMessageId: 'wamid.A',
        from: '558898120001',
        profileName: 'Contato Fictício',
        timestamp: new Date('2026-10-13T12:00:00Z'),
        messageKind: 'text',
        text: 'Oi!',
      }),
      expect.objectContaining({ messageKind: 'button', text: 'Quero saber mais' }),
      expect.objectContaining({ messageKind: 'interactive', text: 'Terça' }),
      expect.objectContaining({ messageKind: 'image', text: 'Nosso escritório' }),
      expect.objectContaining({ messageKind: 'audio', text: null }),
    ]);
  });

  it('reação e item fora do formato são ignorados sem derrubar o resto', () => {
    const events = parseMetaWebhook(
      webhook('messages', {
        messages: [
          {
            from: '558898120001',
            id: 'wamid.R',
            timestamp: ts,
            type: 'reaction',
            reaction: { message_id: 'wamid.X', emoji: '👍' },
          },
          { id: 'sem-remetente', timestamp: ts, type: 'text' },
          {
            from: '558898120001',
            id: 'wamid.ok',
            timestamp: ts,
            type: 'text',
            text: { body: 'ok' },
          },
        ],
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['ignored', 'ignored', 'message']);
  });

  it('lê status com cobrança, nosso id e erro', () => {
    const events = parseMetaWebhook(
      webhook('messages', {
        statuses: [
          {
            id: 'wamid.out',
            status: 'delivered',
            timestamp: ts,
            recipient_id: '558898120001',
            biz_opaque_callback_data: 'msg-123',
            pricing: {
              billable: true,
              pricing_model: 'PMP',
              type: 'regular',
              category: 'marketing',
            },
          },
          {
            id: 'wamid.out2',
            status: 'failed',
            timestamp: ts,
            recipient_id: '558898120002',
            errors: [
              {
                code: 131050,
                title: 'Unable to deliver the message',
                error_data: { details: 'Recipient opted out of marketing messages' },
              },
            ],
          },
          { id: 'wamid.out3', status: 'deleted', timestamp: ts },
        ],
      }),
    );
    expect(events[0]).toEqual({
      type: 'status',
      providerMessageId: 'wamid.out',
      status: 'DELIVERED',
      timestamp: new Date('2026-10-13T12:00:00Z'),
      recipientId: '558898120001',
      reference: 'msg-123',
      pricing: { billable: true, category: 'marketing', type: 'regular' },
      error: null,
    });
    expect(events[1]).toMatchObject({
      status: 'FAILED',
      error: {
        code: '131050',
        title: 'Unable to deliver the message',
        detail: 'Recipient opted out of marketing messages',
      },
    });
    expect(events[2]).toMatchObject({ type: 'ignored' });
    expect(webhookContactIds(events)).toEqual(['558898120001', '558898120002']);
  });

  it('modelos, qualidade, conta e campos não usados', () => {
    expect(
      parseMetaWebhook(
        webhook('message_template_status_update', {
          event: 'REJECTED',
          message_template_id: 123,
          message_template_name: 'apresentacao_parceria',
          message_template_language: 'pt_BR',
          reason: 'INCORRECT_CATEGORY',
        }),
      ),
    ).toEqual([
      {
        type: 'template_status',
        metaTemplateId: '123',
        status: 'REJECTED',
        reason: 'INCORRECT_CATEGORY',
      },
    ]);
    expect(
      parseMetaWebhook(
        webhook('message_template_status_update', {
          event: 'APPROVED',
          message_template_id: '124',
          reason: 'NONE',
        }),
      ),
    ).toEqual([
      { type: 'template_status', metaTemplateId: '124', status: 'APPROVED', reason: null },
    ]);
    expect(
      parseMetaWebhook(
        webhook('message_template_quality_update', {
          previous_quality_score: 'GREEN',
          new_quality_score: 'yellow',
          message_template_id: 125,
        }),
      ),
    ).toEqual([{ type: 'template_quality', metaTemplateId: '125', qualityScore: 'YELLOW' }]);
    expect(
      parseMetaWebhook(webhook('phone_number_quality_update', { event: 'DOWNGRADE' })),
    ).toEqual([{ type: 'account', field: 'phone_number_quality_update', event: 'DOWNGRADE' }]);
    expect(parseMetaWebhook(webhook('calls', {}))).toEqual([
      { type: 'ignored', field: 'calls', reason: 'campo não usado' },
    ]);
  });

  it('corpo que não é do WhatsApp Business é recusado', () => {
    expect(() => parseMetaWebhook({ object: 'page', entry: [] })).toThrow(MetaWebhookFormatError);
    expect(() => parseMetaWebhook('texto')).toThrow(MetaWebhookFormatError);
  });
});

describe('modelos', () => {
  const body = (text: string) => ({ type: 'BODY', text });

  it('variáveis posicionais e nomeadas, na ordem e sem repetir', () => {
    expect(templateVariables('Olá, {{1}}! Em {{2}}, {{1}}.')).toEqual(['1', '2']);
    expect(templateVariables('Oi, {{ nome }}! {{cidade}}')).toEqual(['nome', 'cidade']);
  });

  it('suportado: corpo com variáveis, rodapé e botões fixos', () => {
    const [apresentacao] = FAKE_TEMPLATES;
    expect(analyzeTemplate('MARKETING', apresentacao!.components)).toEqual({
      bodyText: expect.stringContaining('Olá, {{1}}!'),
      bodyParameters: ['1', '2'],
      supported: true,
      unsupportedReason: null,
    });
  });

  it('não suportado: mídia ou variável no cabeçalho, botão dinâmico, autenticação, sem corpo', () => {
    const reason = (category: 'MARKETING' | 'AUTHENTICATION', components: unknown[]) =>
      analyzeTemplate(category, components).unsupportedReason;
    expect(reason('MARKETING', [{ type: 'HEADER', format: 'IMAGE' }, body('Oi')])).toMatch(/mídia/);
    expect(
      reason('MARKETING', [{ type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}' }, body('x')]),
    ).toMatch(/Cabeçalho com variável/);
    expect(
      reason('MARKETING', [
        body('Oi'),
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Site', url: 'https://x.test/{{1}}' }] },
      ]),
    ).toMatch(/Botão/);
    expect(reason('AUTHENTICATION', [body('Código {{1}}')])).toMatch(/autenticação/);
    expect(reason('MARKETING', [{ type: 'FOOTER', text: 'x' }])).toMatch(/sem corpo/);
  });

  it('prévia e validação dos valores', () => {
    expect(renderTemplate('Olá, {{1}}! Em {{2}}.', { '1': 'Ana', '2': 'Sobral' })).toBe(
      'Olá, Ana! Em Sobral.',
    );
    expect(renderTemplate('Olá, {{nome}}!', {})).toBe('Olá, {{nome}}!');
    expect(validateTemplateParams(['1', '2'], { '1': 'Ana', '2': ' ' })).toEqual([
      { parameter: '2', message: 'Preencha esta variável.' },
    ]);
    expect(validateTemplateParams(['1'], { '1': 'linha\noutra', x: 'a' })).toEqual([
      { parameter: '1', message: 'Sem quebra de linha, tabulação ou espaços seguidos.' },
      { parameter: 'x', message: 'Variável que o modelo não tem.' },
    ]);
    expect(validateTemplateParams(['1'], { '1': 'a'.repeat(201) })[0]!.message).toMatch(/200/);
    expect(orderedTemplateParams(['2', '1'], { '1': ' Ana ', '2': 'Crato' })).toEqual([
      { name: '2', value: 'Crato' },
      { name: '1', value: 'Ana' },
    ]);
  });
});

describe('janela de atendimento e status', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('24 h depois da última mensagem do contato', () => {
    const expires = serviceWindowExpiry(new Date('2026-10-12T13:00:00Z'));
    expect(expires).toEqual(new Date('2026-10-13T13:00:00Z'));
    expect(serviceWindow(expires, now)).toEqual({ open: true, expiresAt: expires });
    expect(serviceWindow(new Date('2026-10-13T11:59:59Z'), now).open).toBe(false);
    expect(serviceWindow(null, now)).toEqual({ open: false, expiresAt: null });
  });

  it('status nunca volta; falha só antes da entrega; sucesso corrige falha incerta', () => {
    expect(nextDeliveryStatus('QUEUED', 'SENT')).toBe('SENT');
    expect(nextDeliveryStatus('SENT', 'READ')).toBe('READ');
    expect(nextDeliveryStatus('READ', 'DELIVERED')).toBeNull();
    expect(nextDeliveryStatus('DELIVERED', 'DELIVERED')).toBeNull();
    expect(nextDeliveryStatus('SENT', 'FAILED')).toBe('FAILED');
    expect(nextDeliveryStatus('DELIVERED', 'FAILED')).toBeNull();
    expect(nextDeliveryStatus('FAILED', 'DELIVERED')).toBe('DELIVERED');
    expect(nextDeliveryStatus('RECEIVED', 'READ')).toBeNull();
    expect(nextDeliveryStatus('CANCELED', 'SENT')).toBeNull();
  });
});

describe('erros da Meta', () => {
  it('traduz os códigos e diz quando tentar de novo', () => {
    expect(describeWhatsappError('131047').kind).toBe('WINDOW_CLOSED');
    expect(describeWhatsappError('131050')).toMatchObject({ kind: 'MARKETING_OPT_OUT' });
    expect(describeWhatsappError('TIMEOUT').kind).toBe('UNKNOWN_OUTCOME');
    expect(describeWhatsappError('999999').message).toBe('Erro da Meta (código 999999).');
    expect(isRetryableWhatsappError('130429')).toBe(true);
    expect(isRetryableWhatsappError('131016')).toBe(true);
    expect(isRetryableWhatsappError('131049')).toBe(false);
    expect(isRetryableWhatsappError('TIMEOUT')).toBe(false);
  });
});

describe('configuração e custo', () => {
  it('valores inválidos voltam ao padrão; campos ausentes também', () => {
    expect(resolveWhatsappSettings(undefined)).toEqual(DEFAULT_WHATSAPP_SETTINGS);
    expect(
      resolveWhatsappSettings({ pricesUsd: { marketing: 0.07 }, autoSuggestClassification: false }),
    ).toEqual({
      pricesUsd: { ...DEFAULT_WHATSAPP_SETTINGS.pricesUsd, marketing: 0.07 },
      autoSuggestClassification: false,
    });
    expect(resolveWhatsappSettings({ pricesUsd: { marketing: -1 } })).toEqual(
      DEFAULT_WHATSAPP_SETTINGS,
    );
  });

  it('custo pela categoria do status; não cobrada é zero', () => {
    const prices = DEFAULT_WHATSAPP_SETTINGS.pricesUsd;
    expect(estimateMessageCost({ billable: true, category: 'marketing' }, prices)).toBe(0.0625);
    expect(estimateMessageCost({ billable: true, category: 'utility' }, prices)).toBe(0.008);
    expect(
      estimateMessageCost({ billable: true, category: 'authentication_international' }, prices),
    ).toBe(0.0068);
    expect(estimateMessageCost({ billable: false, category: 'service' }, prices)).toBe(0);
    expect(estimateMessageCost({ billable: true, category: 'nova_categoria' }, prices)).toBe(
      0.0625,
    );
    expect(estimateMessageCost(null, prices)).toBe(0);
  });
});

describe('WhatsApp simulado', () => {
  it('envia texto e modelo aprovado, e guarda o que enviou', async () => {
    const fake = new FakeWhatsappProvider();
    const text = await fake.send({
      kind: 'text',
      to: '5588998120001',
      reference: 'm1',
      body: 'Oi',
    });
    expect(text).toEqual({ providerMessageId: 'wamid.fake-m1-1', waId: '5588998120001' });
    await fake.send({
      kind: 'template',
      to: '5588998120001',
      reference: 'm2',
      template: {
        name: 'apresentacao_parceria',
        language: 'pt_BR',
        parameterFormat: 'POSITIONAL',
        bodyParameters: [
          { name: '1', value: 'Ana' },
          { name: '2', value: 'Sobral' },
        ],
      },
    });
    expect(fake.sent.map((m) => m.reference)).toEqual(['m1', 'm2']);
    expect((await fake.listTemplates()).map((t) => t.status)).toContain('PENDING');
    expect((await fake.getPhoneHealth()).qualityRating).toBe('GREEN');
  });

  it('simula falhas: janela fechada, opt-out de marketing, resultado incerto e modelo pendente', async () => {
    const fake = new FakeWhatsappProvider();
    const send = (body: string) => fake.send({ kind: 'text', to: '55', reference: 'x', body });
    await expect(send('[fake:janela-fechada]')).rejects.toMatchObject({
      details: { code: '131047', outcome: 'NOT_SENT', retryable: false },
    });
    await expect(send('[fake:opt-out]')).rejects.toMatchObject({ details: { code: '131050' } });
    await expect(send('[fake:limite]')).rejects.toMatchObject({ details: { retryable: true } });
    await expect(send('[fake:incerto]')).rejects.toMatchObject({
      details: { outcome: 'UNKNOWN', code: 'TIMEOUT' },
    });
    await expect(
      fake.send({
        kind: 'template',
        to: '55',
        reference: 'y',
        template: {
          name: 'novidades_mensais',
          language: 'pt_BR',
          parameterFormat: 'POSITIONAL',
          bodyParameters: [{ name: '1', value: 'Ana' }],
        },
      }),
    ).rejects.toBeInstanceOf(WhatsappProviderError);
    expect(fake.sent).toEqual([]);
  });
});
