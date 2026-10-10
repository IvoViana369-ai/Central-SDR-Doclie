import { z } from 'zod';

/**
 * Configuração da base aberta do CNPJ (ADMIN), em `app_settings`. Sem linha
 * gravada, valem os padrões abaixo: os mais restritivos.
 */

export const REGISTRY_SETTINGS_KEY = 'registry.settings';

export const registrySettingsSchema = z.object({
  /** Carga automática todo mês (senão, só pelo botão do ADMIN). */
  monthlyIngestion: z.boolean(),
  /**
   * Guardar empresários individuais (e demais naturezas de pessoa física). Os
   * dados desses CNPJs são de uma pessoa: desligado até o parecer jurídico
   * (docs/LGPD.md §20, item 6).
   */
  includeIndividualEntrepreneurs: z.boolean(),
  /** Também estabelecimentos com a contabilidade só como atividade secundária. */
  includeSecondaryCnae: z.boolean(),
});

export type RegistrySettings = z.infer<typeof registrySettingsSchema>;

export const DEFAULT_REGISTRY_SETTINGS: RegistrySettings = {
  monthlyIngestion: true,
  includeIndividualEntrepreneurs: false,
  includeSecondaryCnae: false,
};

export function resolveRegistrySettings(stored: unknown): RegistrySettings {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {};
  const parsed = registrySettingsSchema.safeParse({ ...DEFAULT_REGISTRY_SETTINGS, ...record });
  return parsed.success ? parsed.data : DEFAULT_REGISTRY_SETTINGS;
}

/** "2026-09" é um mês válido da base (a partir de 2018, quando o layout atual começou). */
export function isRegistryReference(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2018 && month >= 1 && month <= 12;
}
