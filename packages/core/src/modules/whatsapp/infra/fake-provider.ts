import {
  WhatsappProviderError,
  type WhatsappOutbound,
  type WhatsappPhoneHealth,
  type WhatsappProvider,
  type WhatsappSendResult,
  type WhatsappTemplateInfo,
} from '../../../ports/whatsapp';

/**
 * WhatsApp simulado (`WHATSAPP_PROVIDER=fake`): desenvolvimento, testes, E2E e
 * demonstração em staging sem conta da Meta. Nada sai do servidor. Os status
 * de entrega e as respostas chegam como na produção, por webhooks no formato
 * da Meta (assinados com `META_APP_SECRET`), por exemplo com
 * `pnpm whatsapp:simulate`.
 *
 * Marcas no texto (ou numa variável do modelo) simulam falhas:
 * `[fake:janela-fechada]` (131047), `[fake:opt-out]` (131050),
 * `[fake:incerto]` (tempo esgotado depois do envio) e `[fake:limite]` (130429).
 */
export class FakeWhatsappProvider implements WhatsappProvider {
  readonly name = 'fake';
  /** Mensagens "enviadas", para os testes conferirem. */
  readonly sent: (WhatsappOutbound & { providerMessageId: string })[] = [];
  private counter = 0;

  constructor(private readonly templates: WhatsappTemplateInfo[] = FAKE_TEMPLATES) {}

  async send(message: WhatsappOutbound): Promise<WhatsappSendResult> {
    const text =
      message.kind === 'text'
        ? message.body
        : message.template.bodyParameters.map((p) => p.value).join(' ');
    if (text.includes('[fake:janela-fechada]')) {
      throw new WhatsappProviderError('Re-engagement message', {
        outcome: 'NOT_SENT',
        retryable: false,
        code: '131047',
        httpStatus: 400,
      });
    }
    if (text.includes('[fake:opt-out]')) {
      throw new WhatsappProviderError('Recipient opted out of marketing', {
        outcome: 'NOT_SENT',
        retryable: false,
        code: '131050',
        httpStatus: 400,
      });
    }
    if (text.includes('[fake:limite]')) {
      throw new WhatsappProviderError('Rate limit hit', {
        outcome: 'NOT_SENT',
        retryable: true,
        code: '130429',
        httpStatus: 429,
      });
    }
    if (text.includes('[fake:incerto]')) {
      throw new WhatsappProviderError('Tempo esgotado', {
        outcome: 'UNKNOWN',
        retryable: false,
        code: 'TIMEOUT',
      });
    }
    if (message.kind === 'template') {
      const template = this.templates.find(
        (t) => t.name === message.template.name && t.language === message.template.language,
      );
      if (!template || template.status !== 'APPROVED') {
        throw new WhatsappProviderError('Template name does not exist in the translation', {
          outcome: 'NOT_SENT',
          retryable: false,
          code: '132001',
          httpStatus: 404,
        });
      }
    }
    this.counter += 1;
    const providerMessageId = `wamid.fake-${message.reference}-${this.counter}`;
    this.sent.push({ ...message, providerMessageId });
    return { providerMessageId, waId: message.to.replace(/\D/g, '') };
  }

  async listTemplates(): Promise<WhatsappTemplateInfo[]> {
    return this.templates.map((t) => structuredClone(t));
  }

  async getPhoneHealth(): Promise<WhatsappPhoneHealth> {
    return {
      displayPhoneNumber: 'Número de demonstração',
      verifiedName: 'Docline (demonstração)',
      qualityRating: 'GREEN',
      messagingLimit: 'TIER_2K',
      status: 'CONNECTED',
      nameStatus: 'APPROVED',
    };
  }
}

/** Modelos fictícios da demonstração (nomes e textos inventados). */
export const FAKE_TEMPLATES: WhatsappTemplateInfo[] = [
  {
    metaTemplateId: 'fake-tpl-apresentacao',
    name: 'apresentacao_parceria',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    qualityScore: 'GREEN',
    rejectedReason: null,
    parameterFormat: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Aqui é da Docline. Temos uma parceria para escritórios de contabilidade em {{2}}. Posso te contar em 2 minutos?',
        example: { body_text: [['Ana', 'Fortaleza']] },
      },
      { type: 'FOOTER', text: 'Responda SAIR para não receber mais mensagens.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Quero saber mais' },
          { type: 'QUICK_REPLY', text: 'Não tenho interesse' },
        ],
      },
    ],
  },
  {
    metaTemplateId: 'fake-tpl-retomada',
    name: 'retomada_contato',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    qualityScore: 'GREEN',
    rejectedReason: null,
    parameterFormat: 'NAMED',
    components: [
      {
        type: 'BODY',
        text: 'Oi, {{nome}}! Conversamos há um tempo sobre a parceria da Docline. Ainda faz sentido para o seu escritório?',
        example: { body_text_named_params: [{ param_name: 'nome', example: 'Ana' }] },
      },
    ],
  },
  {
    metaTemplateId: 'fake-tpl-reuniao',
    name: 'confirmacao_reuniao',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'APPROVED',
    qualityScore: 'UNKNOWN',
    rejectedReason: null,
    parameterFormat: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Confirmando nossa conversa em {{2}}. Até lá!',
        example: { body_text: [['Ana', '15/10 às 10h']] },
      },
    ],
  },
  {
    metaTemplateId: 'fake-tpl-imagem',
    name: 'convite_evento_imagem',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    qualityScore: 'UNKNOWN',
    rejectedReason: null,
    parameterFormat: 'POSITIONAL',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Convite para o nosso encontro de contadores.' },
    ],
  },
  {
    metaTemplateId: 'fake-tpl-pendente',
    name: 'novidades_mensais',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'PENDING',
    qualityScore: null,
    rejectedReason: null,
    parameterFormat: 'POSITIONAL',
    components: [{ type: 'BODY', text: 'Novidades do mês para o seu escritório, {{1}}.' }],
  },
];
