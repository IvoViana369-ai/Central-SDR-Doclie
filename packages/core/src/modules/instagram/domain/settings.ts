import { z } from 'zod';

/**
 * Configuração do Instagram pela API (ADMIN), em `app_settings`. Sem linha
 * gravada, valem os padrões abaixo.
 */

export const INSTAGRAM_SETTINGS_KEY = 'instagram.settings';

export const instagramSettingsSchema = z.object({
  /** Consultar as métricas públicas dos perfis dos leads (Business Discovery, F8-04). */
  discoveryEnabled: z.boolean(),
  /**
   * Consultas por hora, no máximo. A Meta limita as chamadas do Business
   * Discovery por conta; o padrão deixa folga para as mensagens.
   */
  discoveryPerHour: z.number().int().min(1).max(200),
  /** Depois de quantos dias um perfil é consultado de novo. */
  refreshDays: z.number().int().min(7).max(180),
  /** Sugestão da IA nas mensagens recebidas (a pessoa confirma), como no WhatsApp. */
  autoSuggestClassification: z.boolean(),
});

export type InstagramSettings = z.infer<typeof instagramSettingsSchema>;

export const DEFAULT_INSTAGRAM_SETTINGS: InstagramSettings = {
  discoveryEnabled: true,
  discoveryPerHour: 50,
  refreshDays: 30,
  autoSuggestClassification: true,
};

export function resolveInstagramSettings(stored: unknown): InstagramSettings {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {};
  const parsed = instagramSettingsSchema.safeParse({ ...DEFAULT_INSTAGRAM_SETTINGS, ...record });
  return parsed.success ? parsed.data : DEFAULT_INSTAGRAM_SETTINGS;
}

/** Consulta com falha: nova tentativa no dia seguinte (não espera a validade inteira). */
export const DISCOVERY_ERROR_RETRY_HOURS = 24;

/**
 * Datas de corte da consulta de perfis: antes delas, o perfil é consultado de
 * novo (falhas mais cedo que as consultas bem-sucedidas).
 */
export function discoveryCutoffs(settings: InstagramSettings, now: Date) {
  return {
    refreshBefore: new Date(now.getTime() - settings.refreshDays * 86_400_000),
    errorRetryBefore: new Date(now.getTime() - DISCOVERY_ERROR_RETRY_HOURS * 3_600_000),
  };
}
