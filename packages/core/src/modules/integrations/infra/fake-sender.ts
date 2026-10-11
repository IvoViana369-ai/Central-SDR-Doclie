import {
  WebhookTransportError,
  type WebhookRequest,
  type WebhookResponse,
  type WebhookSender,
} from '../../../ports/webhook';

type FakeOutcome = { status: number; body?: string } | { error: WebhookTransportError['code'] };

/**
 * Envio simulado de webhooks (somente testes): guarda cada requisição e
 * responde 200, ou o que o teste programar para a URL.
 */
export class FakeWebhookSender implements WebhookSender {
  readonly requests: WebhookRequest[] = [];
  private readonly outcomes = new Map<string, FakeOutcome>();

  /** Programa a resposta de uma URL (vale até mudar de novo). */
  respond(url: string, outcome: FakeOutcome): void {
    this.outcomes.set(url, outcome);
  }

  async send(request: WebhookRequest): Promise<WebhookResponse> {
    this.requests.push(request);
    const outcome = this.outcomes.get(request.url) ?? { status: 200 };
    if ('error' in outcome) {
      throw new WebhookTransportError(`Falha simulada (${outcome.error}).`, outcome.error);
    }
    return { status: outcome.status, body: outcome.body ?? '', durationMs: 5 };
  }
}
