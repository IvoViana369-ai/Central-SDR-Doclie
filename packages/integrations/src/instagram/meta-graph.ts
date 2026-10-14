import {
  describeInstagramError,
  InstagramProviderError,
  isRetryableInstagramError,
  type InstagramAccountInfo,
  type InstagramDiscovery,
  type InstagramProvider,
  type InstagramSendResult,
  type InstagramUserProfile,
} from '@docline/core';
import { z } from 'zod';

/**
 * Adaptador da API do Instagram com Facebook Login (docs/INTEGRATIONS.md
 * §7.2), direto na Graph API oficial com `fetch`, como o do WhatsApp. É o
 * único lugar que conhece o formato da API.
 *
 * - conta profissional da Docline ligada a uma Página; token da Página gerado
 *   por um System User (nunca token de pessoa);
 * - mensagens pela API de mensagens do Messenger para Instagram
 *   (`/{page-id}/messages`): texto a quem escreveu e resposta privada a comentário;
 * - Business Discovery pela conta da Docline (`/{ig-user-id}?fields=business_discovery…`);
 * - versão da Graph API fixada (META_GRAPH_API_VERSION); sem nova tentativa
 *   aqui, e nunca repetindo um envio de resultado incerto;
 * - fora de produção, só envia com ALLOW_REAL_SENDS=true;
 * - nada de token, @ ou texto nos erros e logs.
 */

export interface MetaGraphInstagramConfig {
  /** Token da Página (System User), com as permissões do Instagram. */
  pageAccessToken: string;
  /** Ex.: v26.0. */
  apiVersion: string;
  pageId: string;
  /** Id da conta profissional do Instagram (IG User). */
  accountId: string;
  /** Produção, ou ALLOW_REAL_SENDS=true. */
  allowSends: boolean;
  /** Só para testes (servidor local que imita a Graph API). */
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
/** @ do Instagram: letras, números, ponto e sublinhado (até 30). */
const HANDLE = /^[a-z0-9._]{1,30}$/i;

const graphError = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).transform(String),
    error_subcode: z.union([z.number(), z.string()]).transform(String).optional(),
  }),
});

const sendResponse = z.object({
  recipient_id: z.string().optional(),
  message_id: z.string().min(1),
});

const userProfile = z.object({
  username: z.string().optional(),
  name: z.string().optional(),
});

const discoveryResponse = z.object({
  business_discovery: z.object({
    followers_count: z.number().int().optional(),
    media_count: z.number().int().optional(),
    media: z
      .object({ data: z.array(z.object({ timestamp: z.string().optional() })).default([]) })
      .optional(),
  }),
});

const accountResponse = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().optional(),
  name: z.string().optional(),
  followers_count: z.number().int().optional(),
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

/** A Graph API manda "2026-10-01T12:00:00+0000" (sem os dois pontos no fuso). */
function graphDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? null : date;
}

export class MetaGraphInstagramProvider implements InstagramProvider {
  readonly name = 'meta_graph';
  readonly accountId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: MetaGraphInstagramConfig) {
    this.accountId = config.accountId;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  sendText(input: { recipientId: string; text: string }): Promise<InstagramSendResult> {
    return this.send({ recipient: { id: input.recipientId }, message: { text: input.text } });
  }

  sendPrivateReply(input: { commentId: string; text: string }): Promise<InstagramSendResult> {
    return this.send({
      recipient: { comment_id: input.commentId },
      message: { text: input.text },
    });
  }

  private async send(body: unknown): Promise<InstagramSendResult> {
    if (!this.config.allowSends) {
      throw new InstagramProviderError(describeInstagramError('REAL_SENDS_DISABLED').message, {
        outcome: 'NOT_SENT',
        retryable: false,
        code: 'REAL_SENDS_DISABLED',
      });
    }
    const json = await this.request('POST', `/${this.config.pageId}/messages`, {
      body,
      sending: true,
    });
    const parsed = sendResponse.safeParse(json);
    if (!parsed.success) {
      // A Meta respondeu 2xx sem o id: não dá para saber o que aconteceu.
      throw new InstagramProviderError(describeInstagramError('INVALID_RESPONSE').message, {
        outcome: 'UNKNOWN',
        retryable: false,
        code: 'INVALID_RESPONSE',
      });
    }
    return {
      providerMessageId: parsed.data.message_id,
      recipientId: parsed.data.recipient_id ?? null,
    };
  }

  async getUserProfile(igsid: string): Promise<InstagramUserProfile | null> {
    try {
      const parsed = userProfile.safeParse(
        await this.request('GET', `/${encodeURIComponent(igsid)}?fields=name,username`),
      );
      if (!parsed.success) return null;
      return {
        username: parsed.data.username?.toLowerCase() ?? null,
        name: parsed.data.name ?? null,
      };
    } catch (error) {
      // Sem consentimento (a pessoa só comentou; código 230) ou bloqueio: o perfil
      // não vem. Token, permissão, limite e rede continuam sendo falhas.
      if (
        error instanceof InstagramProviderError &&
        !error.details.retryable &&
        describeInstagramError(error.details.code).kind !== 'AUTH'
      ) {
        return null;
      }
      throw error;
    }
  }

  async discover(handle: string): Promise<InstagramDiscovery> {
    if (!HANDLE.test(handle)) return { found: false };
    const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(1){timestamp}}`;
    let json: unknown;
    try {
      json = await this.request(
        'GET',
        `/${this.config.accountId}?fields=${encodeURIComponent(fields)}`,
      );
    } catch (error) {
      // Conta inexistente, pessoal ou privada: a Meta recusa o pedido (código
      // 100 ou 110). Limite, token e rede continuam sendo falhas.
      if (
        error instanceof InstagramProviderError &&
        ['100', '110'].includes(error.details.code.split('/')[0]!)
      ) {
        return { found: false };
      }
      throw error;
    }
    const parsed = discoveryResponse.safeParse(json);
    if (!parsed.success) return { found: false };
    const profile = parsed.data.business_discovery;
    return {
      found: true,
      followersCount: profile.followers_count ?? null,
      mediaCount: profile.media_count ?? null,
      lastPostAt: graphDate(profile.media?.data[0]?.timestamp),
    };
  }

  async getAccount(): Promise<InstagramAccountInfo> {
    const parsed = accountResponse.safeParse(
      await this.request(
        'GET',
        `/${this.config.accountId}?fields=id,username,name,followers_count`,
      ),
    );
    if (!parsed.success) {
      throw new InstagramProviderError('Resposta inesperada da Graph API.', {
        outcome: 'NOT_SENT',
        retryable: true,
        code: 'INVALID_RESPONSE',
      });
    }
    return {
      id: parsed.data.id,
      username: parsed.data.username ?? null,
      name: parsed.data.name ?? null,
      followersCount: parsed.data.followers_count ?? null,
    };
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
          authorization: `Bearer ${this.config.pageAccessToken}`,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const code = networkCode(error);
      if (code && NOT_CONNECTED.has(code)) {
        throw new InstagramProviderError(describeInstagramError('UNREACHABLE').message, {
          outcome: 'NOT_SENT',
          retryable: true,
          code: 'UNREACHABLE',
        });
      }
      const local = controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_LOST';
      // Numa leitura, é só tentar de novo; num envio, o pedido pode ter chegado.
      throw new InstagramProviderError(describeInstagramError(local).message, {
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
    const code = parsed.success
      ? parsed.data.error.error_subcode
        ? `${parsed.data.error.code}/${parsed.data.error.error_subcode}`
        : parsed.data.error.code
      : `HTTP_${response.status}`;
    const retryable = isRetryableInstagramError(code) || response.status === 429;
    // 5xx sem código conhecido num envio: a Meta pode ter aceitado.
    const uncertain = options.sending && response.status >= 500 && !retryable;
    throw new InstagramProviderError(describeInstagramError(code).message, {
      outcome: uncertain ? 'UNKNOWN' : 'NOT_SENT',
      retryable,
      code,
      httpStatus: response.status,
    });
  }
}
