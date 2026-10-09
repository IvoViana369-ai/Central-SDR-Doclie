import {
  describeWhatsappError,
  isRetryableWhatsappError,
  WhatsappProviderError,
  type WhatsappOutbound,
  type WhatsappPhoneHealth,
  type WhatsappProvider,
  type WhatsappSendResult,
  type WhatsappTemplateCategory,
  type WhatsappTemplateInfo,
} from '@docline/core';
import { z } from 'zod';

/**
 * Adaptador da WhatsApp Cloud API (docs/INTEGRATIONS.md §6.2), direto na Graph
 * API oficial com `fetch` (a Meta não mantém SDK oficial para Node). É o único
 * lugar que conhece o formato da API de envio.
 *
 * - versão da Graph API fixada (META_GRAPH_API_VERSION) e token de System User;
 * - cada envio leva nosso id em `biz_opaque_callback_data`, devolvido nos status;
 * - sem nova tentativa aqui: o job decide, e nunca repete um envio de
 *   resultado incerto (tempo esgotado ou conexão caída depois do pedido);
 * - fora de produção, só envia com ALLOW_REAL_SENDS=true;
 * - nada de token, número ou texto nos erros e logs.
 */

export interface MetaCloudConfig {
  accessToken: string;
  /** Ex.: v26.0. */
  apiVersion: string;
  phoneNumberId: string;
  businessAccountId: string;
  /** Produção, ou ALLOW_REAL_SENDS=true. */
  allowSends: boolean;
  /** Só para testes (servidor local que imita a Graph API). */
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const MAX_TEMPLATE_PAGES = 20;

const graphError = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).transform(String),
    message: z.string().optional(),
  }),
});

const sendResponse = z.object({
  contacts: z.array(z.object({ wa_id: z.string().optional() })).optional(),
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

const templatePage = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      language: z.string(),
      category: z.string(),
      status: z.string(),
      quality_score: z.object({ score: z.string().optional() }).nullish(),
      rejected_reason: z.string().nullish(),
      parameter_format: z.string().nullish(),
      components: z.array(z.unknown()).default([]),
    }),
  ),
  paging: z.object({ next: z.string().optional() }).optional(),
});

const phoneHealth = z.object({
  display_phone_number: z.string().optional(),
  verified_name: z.string().optional(),
  quality_rating: z.string().optional(),
  status: z.string().optional(),
  name_status: z.string().optional(),
  whatsapp_business_manager_messaging_limit: z.unknown().optional(),
});

/** Erros de rede em que o pedido nem chegou à Meta (pode tentar de novo). */
const NOT_CONNECTED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function networkCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

function category(value: string): WhatsappTemplateCategory {
  const upper = value.toUpperCase();
  return upper === 'UTILITY' || upper === 'AUTHENTICATION' ? upper : 'MARKETING';
}

export class MetaCloudWhatsappProvider implements WhatsappProvider {
  readonly name = 'meta_cloud';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: MetaCloudConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async send(message: WhatsappOutbound): Promise<WhatsappSendResult> {
    if (!this.config.allowSends) {
      throw new WhatsappProviderError(describeWhatsappError('REAL_SENDS_DISABLED').message, {
        outcome: 'NOT_SENT',
        retryable: false,
        code: 'REAL_SENDS_DISABLED',
      });
    }
    const common = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
      biz_opaque_callback_data: message.reference,
    };
    const body =
      message.kind === 'text'
        ? { ...common, type: 'text', text: { body: message.body, preview_url: false } }
        : {
            ...common,
            type: 'template',
            template: {
              name: message.template.name,
              language: { code: message.template.language },
              components:
                message.template.bodyParameters.length > 0
                  ? [
                      {
                        type: 'body',
                        parameters: message.template.bodyParameters.map((p) =>
                          message.template.parameterFormat === 'NAMED'
                            ? { type: 'text', parameter_name: p.name, text: p.value }
                            : { type: 'text', text: p.value },
                        ),
                      },
                    ]
                  : [],
            },
          };
    const json = await this.request('POST', `/${this.config.phoneNumberId}/messages`, {
      body,
      sending: true,
    });
    const parsed = sendResponse.safeParse(json);
    if (!parsed.success) {
      // A Meta respondeu 2xx sem o id: não dá para saber o que aconteceu.
      throw new WhatsappProviderError(describeWhatsappError('INVALID_RESPONSE').message, {
        outcome: 'UNKNOWN',
        retryable: false,
        code: 'INVALID_RESPONSE',
      });
    }
    return {
      providerMessageId: parsed.data.messages[0]!.id,
      waId: parsed.data.contacts?.[0]?.wa_id ?? null,
    };
  }

  async listTemplates(): Promise<WhatsappTemplateInfo[]> {
    const fields =
      'id,name,language,category,status,quality_score,rejected_reason,parameter_format,components';
    let path: string | null =
      `/${this.config.businessAccountId}/message_templates?fields=${fields}&limit=100`;
    const templates: WhatsappTemplateInfo[] = [];
    for (let page = 0; path && page < MAX_TEMPLATE_PAGES; page += 1) {
      const parsed = templatePage.safeParse(await this.request('GET', path));
      if (!parsed.success) throw this.unexpected();
      for (const t of parsed.data.data) {
        templates.push({
          metaTemplateId: t.id,
          name: t.name,
          language: t.language,
          category: category(t.category),
          status: t.status.toUpperCase(),
          qualityScore: t.quality_score?.score?.toUpperCase() ?? null,
          rejectedReason:
            t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
          parameterFormat: t.parameter_format?.toUpperCase() === 'NAMED' ? 'NAMED' : 'POSITIONAL',
          components: t.components,
        });
      }
      path = this.nextPath(parsed.data.paging?.next);
    }
    return templates;
  }

  async getPhoneHealth(): Promise<WhatsappPhoneHealth> {
    const fields =
      'display_phone_number,verified_name,quality_rating,status,name_status,whatsapp_business_manager_messaging_limit';
    const parsed = phoneHealth.safeParse(
      await this.request('GET', `/${this.config.phoneNumberId}?fields=${fields}`),
    );
    if (!parsed.success) throw this.unexpected();
    const limit = parsed.data.whatsapp_business_manager_messaging_limit;
    return {
      displayPhoneNumber: parsed.data.display_phone_number ?? null,
      verifiedName: parsed.data.verified_name ?? null,
      qualityRating: parsed.data.quality_rating?.toUpperCase() ?? null,
      messagingLimit: typeof limit === 'string' ? limit : null,
      status: parsed.data.status?.toUpperCase() ?? null,
      nameStatus: parsed.data.name_status?.toUpperCase() ?? null,
    };
  }

  /** Paginação: só segue links da própria Graph API (nunca outro host). */
  private nextPath(next: string | undefined): string | null {
    if (!next) return null;
    const prefix = `${this.baseUrl}/${this.config.apiVersion}`;
    return next.startsWith(`${prefix}/`) ? next.slice(prefix.length) : null;
  }

  private unexpected() {
    return new WhatsappProviderError('Resposta inesperada da Graph API.', {
      outcome: 'NOT_SENT',
      retryable: true,
      code: 'INVALID_RESPONSE',
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; sending?: boolean } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${this.config.apiVersion}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const code = networkCode(error);
      if (code && NOT_CONNECTED.has(code)) {
        throw new WhatsappProviderError(describeWhatsappError('UNREACHABLE').message, {
          outcome: 'NOT_SENT',
          retryable: true,
          code: 'UNREACHABLE',
        });
      }
      const local = controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_LOST';
      // Numa leitura, é só tentar de novo; num envio, o pedido pode ter chegado.
      throw new WhatsappProviderError(describeWhatsappError(local).message, {
        outcome: options.sending ? 'UNKNOWN' : 'NOT_SENT',
        retryable: !options.sending,
        code: local,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (response.ok) return json;

    const parsed = graphError.safeParse(json);
    const code = parsed.success ? parsed.data.error.code : `HTTP_${response.status}`;
    const retryable = isRetryableWhatsappError(code) || response.status === 429;
    // 5xx sem código conhecido num envio: a Meta pode ter aceitado.
    const uncertain = options.sending && response.status >= 500 && !retryable;
    throw new WhatsappProviderError(describeWhatsappError(code).message, {
      outcome: uncertain ? 'UNKNOWN' : 'NOT_SENT',
      retryable,
      code,
      httpStatus: response.status,
    });
  }
}
