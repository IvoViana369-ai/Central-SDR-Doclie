import type { ServerEnv } from '@docline/config';
import {
  FakeAiProvider,
  FakeInstagramProvider,
  FakeWhatsappProvider,
  type AiLimits,
  type AiProvider,
  type EmailProvider,
  type InstagramProvider,
  type Logger,
  type WhatsappProvider,
} from '@docline/core';
import { AnthropicAiProvider } from './ai/anthropic';
import { MetaGraphInstagramProvider } from './instagram/meta-graph';
import { MetaCloudWhatsappProvider } from './whatsapp/meta-cloud';
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

/**
 * WhatsApp pela API (docs/INTEGRATIONS.md §6.2): `assisted` (padrão) não tem
 * provedor, só o link `wa.me`; `fake` simula sem enviar nada; `meta_cloud` usa
 * a Cloud API e, fora de produção, só envia com ALLOW_REAL_SENDS=true.
 */
export function createWhatsappProvider(env: ServerEnv): WhatsappProvider | null {
  switch (env.WHATSAPP_PROVIDER) {
    case 'assisted':
      return null;
    case 'fake':
      return new FakeWhatsappProvider();
    case 'meta_cloud':
      return new MetaCloudWhatsappProvider({
        accessToken: env.META_ACCESS_TOKEN!,
        apiVersion: env.META_GRAPH_API_VERSION!,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
        businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
        allowSends: env.APP_ENV === 'production' || env.ALLOW_REAL_SENDS,
      });
  }
}

/** Segredos dos webhooks da Meta, ou `null` se o endpoint não deve aceitar nada. */
export function whatsappWebhookConfig(
  env: ServerEnv,
): { appSecret: string; verifyToken: string } | null {
  if (env.WHATSAPP_PROVIDER === 'assisted') return null;
  if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) return null;
  return { appSecret: env.META_APP_SECRET, verifyToken: env.META_WEBHOOK_VERIFY_TOKEN };
}

/**
 * Instagram pela API (docs/INTEGRATIONS.md §7.2): `assisted` (padrão) não tem
 * provedor, só "copiar e abrir o perfil"; `fake` simula sem enviar nada;
 * `meta_graph` usa a API com Facebook Login e, fora de produção, só envia com
 * ALLOW_REAL_SENDS=true.
 */
export function createInstagramProvider(env: ServerEnv): InstagramProvider | null {
  switch (env.INSTAGRAM_PROVIDER) {
    case 'assisted':
      return null;
    case 'fake':
      return new FakeInstagramProvider();
    case 'meta_graph':
      return new MetaGraphInstagramProvider({
        pageAccessToken: env.INSTAGRAM_PAGE_ACCESS_TOKEN!,
        apiVersion: env.META_GRAPH_API_VERSION!,
        pageId: env.FACEBOOK_PAGE_ID!,
        accountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID!,
        allowSends: env.APP_ENV === 'production' || env.ALLOW_REAL_SENDS,
      });
  }
}

/** Segredos do webhook do Instagram (o mesmo app da Meta), ou `null` sem provedor. */
export function instagramWebhookConfig(
  env: ServerEnv,
): { appSecret: string; verifyToken: string } | null {
  if (env.INSTAGRAM_PROVIDER === 'assisted') return null;
  if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) return null;
  return { appSecret: env.META_APP_SECRET, verifyToken: env.META_WEBHOOK_VERIFY_TOKEN };
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
  'meta_cloud',
  'meta_graph',
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
