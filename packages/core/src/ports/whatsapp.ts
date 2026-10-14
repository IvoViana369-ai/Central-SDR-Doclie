/**
 * Porta do WhatsApp em modo API (docs/INTEGRATIONS.md §6.2). O domínio manda
 * mensagens com tipos próprios e recebe o id do provedor; nenhum tipo de SDK ou
 * da Graph API atravessa a porta. Os webhooks chegam no formato da Meta e são
 * lidos por `parseMetaWebhook` (o provedor falso também fala esse formato).
 *
 * Sem provedor (`WHATSAPP_PROVIDER=assisted`), `CoreDeps.whatsapp` é `null` e
 * só o modo assistido (`wa.me`) existe.
 */

export type WhatsappTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type WhatsappParameterFormat = 'POSITIONAL' | 'NAMED';

interface WhatsappOutboundBase {
  /** Número do destinatário: `wa_id` da conversa ou o E.164 sem o "+". */
  to: string;
  /** Nosso id da mensagem, devolvido pela Meta nos status (biz_opaque_callback_data). */
  reference: string;
}

export interface WhatsappTextOutbound extends WhatsappOutboundBase {
  kind: 'text';
  body: string;
}

export interface WhatsappTemplateOutbound extends WhatsappOutboundBase {
  kind: 'template';
  template: {
    name: string;
    language: string;
    parameterFormat: WhatsappParameterFormat;
    /** Variáveis do corpo, na ordem do modelo. */
    bodyParameters: { name: string; value: string }[];
  };
}

export type WhatsappOutbound = WhatsappTextOutbound | WhatsappTemplateOutbound;

export interface WhatsappSendResult {
  providerMessageId: string;
  /** `wa_id` que a Meta associou ao número (pode vir sem o 9º dígito). */
  waId: string | null;
}

/** Modelo como está na conta da Meta (componentes no formato da Meta, guardados como JSON). */
export interface WhatsappTemplateInfo {
  metaTemplateId: string;
  name: string;
  language: string;
  category: WhatsappTemplateCategory;
  status: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  parameterFormat: WhatsappParameterFormat;
  components: unknown[];
}

/** Situação do número na Meta (sem segredos). */
export interface WhatsappPhoneHealth {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** GREEN, YELLOW, RED, UNKNOWN… */
  qualityRating: string | null;
  /** Limite de mensagens fora da janela (nível da empresa na Meta). */
  messagingLimit: string | null;
  /** CONNECTED, FLAGGED, RESTRICTED… */
  status: string | null;
  nameStatus: string | null;
}

/**
 * Como a falha deixa a mensagem:
 * - `NOT_SENT`: a Meta não aceitou (ou o pedido nem saiu); pode haver nova tentativa se `retryable`.
 * - `UNKNOWN`: o pedido saiu e a resposta não chegou (tempo esgotado, conexão
 *   caída). Nunca se reenvia sozinho: o status do webhook resolve, ou uma pessoa.
 */
export type WhatsappSendOutcome = 'NOT_SENT' | 'UNKNOWN';

/** Falha do provedor já traduzida (código da Meta, quando houver, para a mensagem ao usuário). */
export class WhatsappProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      outcome: WhatsappSendOutcome;
      retryable: boolean;
      /** Código de erro da Meta (ex.: 131047), ou nosso código quando não há (ex.: TIMEOUT). */
      code: string;
      httpStatus?: number;
    },
  ) {
    super(message);
    this.name = 'WhatsappProviderError';
  }
}

export interface WhatsappProvider {
  /** `fake` ou `meta_cloud` (gravado em `messages.provider`). */
  readonly name: string;
  send(message: WhatsappOutbound): Promise<WhatsappSendResult>;
  listTemplates(): Promise<WhatsappTemplateInfo[]>;
  getPhoneHealth(): Promise<WhatsappPhoneHealth>;
}
