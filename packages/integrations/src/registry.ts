import type { ServerEnv } from '@docline/config';
import {
  FakeAiProvider,
  type AiLimits,
  type AiProvider,
  type EmailProvider,
  type Logger,
} from '@docline/core';
import { AnthropicAiProvider } from './ai/anthropic';
import { ConsoleEmailProvider } from './email/console';
import { FileEmailProvider } from './email/file';
import { ResendEmailProvider } from './email/resend';
import { SmtpEmailProvider } from './email/smtp';

/**
 * Registro de provedores (docs/INTEGRATIONS.md §4): escolhe adaptadores pelo
 * ambiente. Provedores reais de fases futuras falham na inicialização com
 * mensagem clara, em vez de quebrar no meio de uma operação.
 */
export function createEmailProvider(env: ServerEnv, logger: Logger): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'console':
      return new ConsoleEmailProvider(logger);
    case 'file':
      return new FileEmailProvider(env.EMAIL_OUTBOX_FILE);
    case 'smtp':
      return new SmtpEmailProvider(env.SMTP_URL!, env.EMAIL_FROM);
    case 'resend':
      return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
  }
}

/**
 * IA (docs/AI-SDR.md §4): `fake` é o padrão até a Docline aprovar o envio de
 * dados ao provedor (transferência internacional, LGPD art. 33). A chave vem
 * só do ambiente (AI_API_KEY), validada na subida.
 */
export function createAiProvider(env: ServerEnv): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'fake':
      return new FakeAiProvider();
    case 'anthropic':
      return new AnthropicAiProvider({
        apiKey: env.AI_API_KEY!,
        model: env.AI_MODEL,
        classificationModel: env.AI_MODEL_CLASSIFICATION || env.AI_MODEL,
      });
  }
}

export function aiLimitsFromEnv(env: ServerEnv): AiLimits {
  return {
    effortGeneration: env.AI_EFFORT_GENERATION,
    effortClassification: env.AI_EFFORT_CLASSIFICATION,
    maxGenerationsPerUserPerDay: env.AI_MAX_GENERATIONS_PER_USER_PER_DAY,
    monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD ?? null,
  };
}

export type IntegrationKey =
  'whatsapp' | 'instagram' | 'places' | 'companyRegistry' | 'ai' | 'email' | 'crm' | 'errors';

export interface IntegrationStatus {
  key: IntegrationKey;
  label: string;
  provider: string;
  /** Fase do roadmap em que o modo real é implementado. */
  phase: number;
  state: 'active' | 'assisted' | 'simulated' | 'disabled' | 'not_implemented';
}

/** Provedores reais já implementados nesta versão. */
const IMPLEMENTED = new Set([
  'assisted',
  'fake',
  'disabled',
  'console',
  'file',
  'smtp',
  'resend',
  'sentry',
  'anthropic',
]);

export function integrationStatuses(env: ServerEnv): IntegrationStatus[] {
  const entry = (
    key: IntegrationKey,
    label: string,
    provider: string,
    phase: number,
  ): IntegrationStatus => ({
    key,
    label,
    provider,
    phase,
    state: !IMPLEMENTED.has(provider)
      ? 'not_implemented'
      : provider === 'assisted'
        ? 'assisted'
        : provider === 'fake' || provider === 'console' || provider === 'file'
          ? 'simulated'
          : provider === 'disabled'
            ? 'disabled'
            : 'active',
  });
  return [
    entry('whatsapp', 'WhatsApp', env.WHATSAPP_PROVIDER, 7),
    entry('instagram', 'Instagram', env.INSTAGRAM_PROVIDER, 8),
    entry('places', 'Google Places', env.PLACES_PROVIDER, 9),
    entry('companyRegistry', 'Dados de CNPJ', env.COMPANY_REGISTRY_PROVIDER, 9),
    entry('ai', 'IA (SDR AI)', env.AI_PROVIDER, 6),
    entry('email', 'E-mail transacional', env.EMAIL_PROVIDER, 1),
    entry('crm', 'CRM Docline', env.CRM_PROVIDER, 12),
    entry('errors', 'Monitoramento de erros', env.SENTRY_DSN ? 'sentry' : 'disabled', 2),
  ];
}

/** Falha cedo se o ambiente pedir um provedor ainda não implementado. */
export function assertProvidersImplemented(env: ServerEnv): void {
  const missing = integrationStatuses(env).filter((s) => s.state === 'not_implemented');
  if (missing.length > 0) {
    const list = missing
      .map((s) => `${s.label}="${s.provider}" (previsto para a Fase ${s.phase})`)
      .join(', ');
    throw new Error(`Provedor(es) ainda não implementado(s) nesta versão: ${list}.`);
  }
}
