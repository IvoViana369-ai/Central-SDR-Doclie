import type { ZodType } from 'zod';

/**
 * Porta da IA (docs/AI-SDR.md §3). Nenhum tipo de SDK de terceiros atravessa
 * a porta: o domínio manda prompts e um schema Zod e recebe a saída já
 * validada, com uso de tokens e o modelo que atendeu.
 */

export type AiTask = 'outreach_message' | 'reply_classification' | 'portfolio_insights';
export type AiEffort = 'low' | 'medium' | 'high';

export interface AiStructuredRequest<T> {
  task: AiTask;
  /** Prompt estável (cacheável). */
  system: string;
  /** Pedido e contexto do lead, delimitados como dados. */
  input: string;
  schema: ZodType<T>;
  effort: AiEffort;
  maxOutputTokens: number;
}

export interface AiTokenUsage {
  /** Entrada sem cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AiStructuredResult<T> {
  data: T;
  usage: AiTokenUsage;
  /** Modelo que atendeu (pode ser o de fallback). */
  model: string;
  latencyMs: number;
  stopReason: string;
  /** O pedido foi recusado pelo modelo principal e atendido por outro. */
  fallbackUsed: boolean;
}

export type AiErrorCode =
  | 'REFUSAL'
  | 'MAX_TOKENS'
  | 'INVALID_OUTPUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'AUTH'
  | 'BAD_REQUEST';

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set([
  'INVALID_OUTPUT',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'TIMEOUT',
]);

/** Falha do provedor, já traduzida para o domínio (sem detalhes do SDK). */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly details: { model?: string; usage?: AiTokenUsage; latencyMs?: number } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.retryable = RETRYABLE.has(code);
  }
}

export interface AiProvider {
  /** `fake` ou `anthropic` (gravado em `ai_generations.provider`). */
  readonly name: string;
  /** Modelo de geração e de classificação, para registro e custo. */
  readonly models: { generation: string; classification: string };
  generateStructured<T>(request: AiStructuredRequest<T>): Promise<AiStructuredResult<T>>;
}
