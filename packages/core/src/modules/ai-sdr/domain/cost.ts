/**
 * Estimativa de custo por geração (docs/AI-SDR.md §15), em dólares, com a
 * tabela do fornecedor de out/2026 (US$ por milhão de tokens). É estimativa:
 * a fatura da Anthropic é a fonte oficial. Raciocínio do modelo é cobrado
 * como saída e já vem somado em `outputTokens`.
 */
interface ModelPrice {
  input: number;
  output: number;
  /** Leitura do cache de prompt. */
  cacheRead: number;
  /** Escrita no cache (TTL de 5 minutos): 1,25 × entrada. */
  cacheWrite: number;
}

const price = (input: number, output: number, cacheRead: number): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-opus-4-8': price(5, 25, 0.5),
  'claude-sonnet-5-5': price(2, 10, 0.2),
  'claude-haiku-5-5': price(0.1, 0.5, 0.01),
  /** Provedor falso (desenvolvimento e testes): sem custo. */
  'fake-sdr': price(0, 0, 0),
};

export interface AiUsage {
  /** Entrada sem cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Custo em US$ (6 casas) ou null para modelo sem preço cadastrado. */
export function estimateCostUsd(model: string, usage: AiUsage): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const total =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    (usage.cacheReadTokens ?? 0) * p.cacheRead +
    (usage.cacheWriteTokens ?? 0) * p.cacheWrite;
  return Math.round(total) / 1_000_000;
}
