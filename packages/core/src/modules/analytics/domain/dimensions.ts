/**
 * Recortes da conversão (F11-02), pela coorte do 1º contato: cada lead entra
 * uma vez, no recorte do seu 1º contato (canal, abordagem, campanha e quem
 * fez) ou do seu cadastro (cidade, UF, segmento, origem, responsável).
 */

export const CONVERSION_DIMENSIONS = [
  'city',
  'state',
  'segment',
  'source',
  'owner',
  'firstContactUser',
  'campaign',
  'approach',
  'channel',
] as const;
export type ConversionDimension = (typeof CONVERSION_DIMENSIONS)[number];

export const CONVERSION_DIMENSION_LABELS: Record<ConversionDimension, string> = {
  city: 'Cidade',
  state: 'UF',
  segment: 'Segmento',
  source: 'Origem',
  owner: 'Responsável',
  firstContactUser: 'Quem fez o 1º contato',
  campaign: 'Campanha',
  approach: 'Abordagem',
  channel: 'Canal do 1º contato',
};

/** Rótulo de quem não tem o recorte (ex.: 1º contato fora de campanha). */
export const CONVERSION_NULL_LABELS: Record<ConversionDimension, string> = {
  city: 'Sem cidade',
  state: 'Sem UF',
  segment: 'Sem segmento',
  source: 'Sem origem',
  owner: 'Sem responsável',
  firstContactUser: 'Não identificado',
  campaign: 'Fora de campanha',
  approach: 'Sem abordagem registrada',
  channel: 'Não identificado',
};

/** Canais do 1º contato e das mensagens (ligação atendida = telefone). */
export const ANALYTICS_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  SMS: 'SMS',
  OTHER: 'Outro (reunião, visita…)',
};
