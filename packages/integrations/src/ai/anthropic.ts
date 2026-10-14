import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  AiProviderError,
  type AiProvider,
  type AiStructuredRequest,
  type AiStructuredResult,
  type AiTokenUsage,
} from '@docline/core';
import type { ZodType } from 'zod';

/**
 * Adaptador Anthropic (docs/AI-SDR.md §4) com o SDK oficial:
 *
 * - saída estruturada validada pelo schema Zod (`output_config.format`);
 * - esforço explícito (`output_config.effort`): no Claude Opus 5.5 o raciocínio
 *   é sempre adaptativo e o padrão do modelo é `medium`;
 * - prompt de sistema com `cache_control` (prefixo estável entre leads);
 * - fallback de recusa do lado do servidor (`fallbacks: "default"`): se o
 *   classificador de segurança do modelo recusar, a API refaz o pedido no
 *   modelo recomendado para aquela categoria, na mesma chamada;
 * - `stop_reason` conferido antes de ler o conteúdo;
 * - erros do SDK traduzidos para `AiProviderError` (retentáveis ou não).
 *
 * Nada de prompt ou resposta vai para o log (§16).
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicAiConfig {
  apiKey: string;
  model: string;
  classificationModel: string;
  /** Tempo máximo por tentativa (ms). O SDK repete 429, 5xx e falhas de conexão. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Só para testes (servidor local que simula a API). */
  baseURL?: string;
}

function usageOf(usage: Anthropic.Beta.BetaUsage | undefined): AiTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

function translateError(error: unknown, model: string): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError(
      'RATE_LIMITED',
      'Limite de uso da IA atingido; tente em instantes.',
      { model },
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiProviderError('AUTH', 'Credencial da IA inválida ou sem permissão.', { model });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError('TIMEOUT', 'A IA demorou demais para responder.', { model });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AiProviderError('BAD_REQUEST', 'Pedido recusado pela API de IA (configuração).', {
      model,
    });
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiProviderError('UNAVAILABLE', 'Provedor de IA indisponível.', { model });
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(
      error.status && error.status >= 500 ? 'UNAVAILABLE' : 'BAD_REQUEST',
      'Falha na API de IA.',
      { model },
    );
  }
  return new AiProviderError('UNAVAILABLE', 'Falha inesperada ao chamar a IA.', { model });
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly models: { generation: string; classification: string };
  private readonly client: Anthropic;

  constructor(config: AnthropicAiConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 60_000,
      maxRetries: config.maxRetries ?? 2,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.models = { generation: config.model, classification: config.classificationModel };
  }

  async generateStructured<T>(request: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    const model =
      request.task === 'reply_classification' ? this.models.classification : this.models.generation;
    const format = betaZodOutputFormat(request.schema as ZodType<T>);
    const started = Date.now();
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model,
        max_tokens: request.maxOutputTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.input }],
        output_config: { effort: request.effort, format },
      });
    } catch (error) {
      throw translateError(error, model);
    }
    const latencyMs = Date.now() - started;
    const usage = usageOf(response.usage);
    const details = { model: response.model, usage, latencyMs };

    // stop_reason antes do conteúdo: recusa e corte por tamanho não têm saída válida.
    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('REFUSAL', 'O modelo recusou o pedido.', details);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError(
        'MAX_TOKENS',
        'A resposta da IA foi cortada pelo limite de tamanho.',
        details,
      );
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let data: T;
    try {
      data = format.parse(text);
    } catch {
      throw new AiProviderError(
        'INVALID_OUTPUT',
        'A saída da IA não seguiu o formato esperado.',
        details,
      );
    }
    return {
      data,
      usage,
      model: response.model,
      latencyMs,
      stopReason: response.stop_reason ?? 'end_turn',
      fallbackUsed: (response.usage?.iterations ?? []).some((i) => i.type === 'fallback_message'),
    };
  }
}
