/**
 * Sistemas Docline e referências externas (F12-03; docs/INTEGRATIONS.md §11.3).
 * O código do sistema é livre (para não depender de migração a cada sistema
 * novo), mas segue o formato abaixo; os conhecidos ganham nome.
 */

export const SYSTEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

export const KNOWN_SYSTEMS = {
  DOCLINE_CRM: 'CRM Docline',
  GESTAO_AR: 'Docline Gestão AR',
  GESTAO_360: 'Docline Gestão 360',
  N8N: 'n8n',
  BI: 'BI',
} as const satisfies Record<string, string>;

export function systemLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return (KNOWN_SYSTEMS as Record<string, string>)[code] ?? code;
}

export const EXTERNAL_ENTITY_TYPES = ['LEAD', 'OPPORTUNITY'] as const;
export type ExternalEntityType = (typeof EXTERNAL_ENTITY_TYPES)[number];

export const EXTERNAL_ENTITY_LABELS: Record<ExternalEntityType, string> = {
  LEAD: 'Lead',
  OPPORTUNITY: 'Oportunidade',
};

export const EXTERNAL_ID_MAX_LENGTH = 200;

/** Formato das chaves de API: "dsdr_" + 8 caracteres de prefixo + "_" + 43 de segredo. */
export const API_KEY_PATTERN = /^dsdr_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/;

/** Parte visível (prefixo) de uma chave bem formada; null se o formato não bate. */
export function apiKeyPrefix(key: string): string | null {
  return API_KEY_PATTERN.test(key) ? key.slice(0, 13) : null;
}
