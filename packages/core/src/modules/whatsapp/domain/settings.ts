import { z } from 'zod';

/**
 * Configuração do WhatsApp pela API (ADMIN), em `app_settings`. Sem linha
 * gravada, valem os padrões abaixo.
 *
 * Preços: estimativa por mensagem cobrada, por categoria, em US$ (a Meta cobra
 * por mensagem desde julho de 2025; a fatura da Meta é a fonte oficial). Os
 * padrões são da tabela pública para o Brasil e devem ser conferidos pelo ADMIN.
 */

export const WHATSAPP_SETTINGS_KEY = 'whatsapp.settings';

const price = z.number().min(0).max(1);

export const whatsappSettingsSchema = z.object({
  /** US$ por mensagem cobrada, por categoria informada pela Meta no status. */
  pricesUsd: z.object({
    marketing: price,
    utility: price,
    authentication: price,
    service: price,
  }),
  /**
   * Pedir à IA a sugestão de classificação assim que uma resposta chega pela
   * API (F7-07). A sugestão nunca classifica sozinha: a pessoa confirma.
   */
  autoSuggestClassification: z.boolean(),
});

export type WhatsappSettings = z.infer<typeof whatsappSettingsSchema>;

export const DEFAULT_WHATSAPP_SETTINGS: WhatsappSettings = {
  pricesUsd: { marketing: 0.0625, utility: 0.008, authentication: 0.0068, service: 0 },
  autoSuggestClassification: true,
};

export function resolveWhatsappSettings(stored: unknown): WhatsappSettings {
  const record = isRecord(stored) ? stored : {};
  const merged = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    ...record,
    pricesUsd: {
      ...DEFAULT_WHATSAPP_SETTINGS.pricesUsd,
      ...(isRecord(record.pricesUsd) ? record.pricesUsd : {}),
    },
  };
  const parsed = whatsappSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_WHATSAPP_SETTINGS;
}

/**
 * Custo estimado de uma mensagem a partir do `pricing` do status. Mensagem não
 * cobrada (ou sem informação) custa zero; categoria desconhecida usa marketing,
 * a mais cara, para não subestimar.
 */
export function estimateMessageCost(
  pricing: { billable: boolean | null; category: string | null } | null,
  prices: WhatsappSettings['pricesUsd'],
): number {
  if (!pricing || pricing.billable === false || pricing.billable === null) return 0;
  const category = (pricing.category ?? '').toLowerCase();
  if (category.startsWith('authentication')) return prices.authentication;
  if (category === 'utility') return prices.utility;
  if (category === 'service' || category === 'referral_conversion') return prices.service;
  return prices.marketing;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
