/**
 * Porta do envio de webhooks de saída (F12-02; docs/INTEGRATIONS.md §11.2).
 * O adaptador faz um único POST: resolve o DNS e confere cada endereço contra a
 * proteção de SSRF antes de conectar (no IP aprovado), não segue
 * redirecionamentos, não manda cookies, corta pelo tempo e lê só o começo da
 * resposta. A assinatura e as novas tentativas ficam no core.
 */

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookResponse {
  status: number;
  /** Começo da resposta (até 2 KB), para o registro da entrega. */
  body: string;
  durationMs: number;
}

/** Falha antes de haver resposta HTTP. */
export class WebhookTransportError extends Error {
  constructor(
    message: string,
    readonly code:
      /** Endereço bloqueado pela proteção de SSRF (rede interna, metadados…). */
      | 'BLOCKED'
      /** Nome não resolvido no DNS. */
      | 'DNS'
      /** Tempo esgotado. */
      | 'TIMEOUT'
      /** Conexão recusada, TLS inválido ou conexão caída. */
      | 'NETWORK',
  ) {
    super(message);
    this.name = 'WebhookTransportError';
  }
}

export interface WebhookSender {
  send(request: WebhookRequest): Promise<WebhookResponse>;
}
