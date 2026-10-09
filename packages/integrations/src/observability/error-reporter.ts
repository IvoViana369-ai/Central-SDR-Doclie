import * as Sentry from '@sentry/node';

/**
 * Envio de erros ao Sentry (F2-17; docs/SECURITY.md §5). Opcional: sem
 * `SENTRY_DSN`, nada é enviado. Só erros, sem dados pessoais:
 * - sem tracing, sem instrumentação automática (OpenTelemetry) e sem
 *   breadcrumbs: apenas o que a aplicação captura de propósito;
 * - sem usuário, cookies, cabeçalhos ou corpo de requisição;
 * - e-mails e sequências longas de dígitos (telefone, CPF, CNPJ) são
 *   trocados por marcadores em toda mensagem antes de sair do servidor.
 */

export interface ErrorContext {
  requestId?: string;
  /** Rota ou página (sem query string). */
  route?: string;
  /** Job do worker. */
  job?: string;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorContext): void;
  /** Espera o envio pendente (ex.: antes de encerrar o processo). */
  flush(timeoutMs?: number): Promise<void>;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** 8 ou mais dígitos, com ou sem pontuação (telefone, CPF, CNPJ). */
const LONG_NUMBER = /\+?\(?\d(?:[\d\s().\-/]{6,}\d)/g;

export function scrubText(text: string): string {
  return text
    .replace(EMAIL, '[e-mail]')
    .replace(LONG_NUMBER, (match) => (match.replace(/\D/g, '').length >= 8 ? '[número]' : match));
}

export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  return event;
}

const noop: ErrorReporter = {
  enabled: false,
  capture: () => undefined,
  flush: async () => undefined,
};

export function createErrorReporter(options: {
  dsn: string | undefined;
  environment: string;
  service: 'web' | 'worker';
}): ErrorReporter {
  if (!options.dsn) return noop;
  Sentry.initWithoutDefaultIntegrations({
    dsn: options.dsn,
    environment: options.environment,
    serverName: options.service,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    maxBreadcrumbs: 0,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    beforeSend: scrubEvent,
  });
  return {
    enabled: true,
    capture(error, context = {}) {
      Sentry.captureException(error, {
        tags: { service: options.service, ...context },
      });
    },
    async flush(timeoutMs = 2_000) {
      await Sentry.flush(timeoutMs);
    },
  };
}
