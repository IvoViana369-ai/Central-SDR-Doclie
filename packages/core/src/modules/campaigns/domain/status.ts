import type { CampaignLeadStatus, CampaignStatus } from '@docline/db';

/**
 * Ciclo de vida da campanha (F10-01). Rascunho → montando (retrato do filtro e
 * elegibilidade) → pronta → ativa ⇄ pausada → concluída → arquivada. Rascunho
 * e pronta podem ser arquivadas para descarte; falha na montagem volta ao
 * rascunho com o erro registrado. Campanha nenhuma envia mensagem: ela só
 * libera leads para a cadência, e cada contato passa pelo gate de sempre.
 */

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'BUILDING',
  'READY',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const satisfies readonly CampaignStatus[];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Rascunho',
  BUILDING: 'Montando',
  READY: 'Pronta',
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  ARCHIVED: 'Arquivada',
};

export const CAMPAIGN_LEAD_STATUS_LABELS: Record<CampaignLeadStatus, string> = {
  PENDING: 'Aguardando liberação',
  RELEASED: 'Na fila',
  SKIPPED: 'Pulado na liberação',
  REMOVED: 'Retirado',
};

const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ['BUILDING', 'ARCHIVED'],
  // Montagem concluída ou falha (volta ao rascunho com o erro).
  BUILDING: ['READY', 'DRAFT'],
  // Remontar o retrato, voltar a editar, ativar ou descartar.
  READY: ['BUILDING', 'DRAFT', 'ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'COMPLETED'],
  PAUSED: ['ACTIVE', 'COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Filtro, canal, cadência, SDRs, variantes e frequência: só antes de ativar. */
export function canEditStructure(status: CampaignStatus): boolean {
  return status === 'DRAFT' || status === 'READY';
}

/** Nome, objetivo, dono, limite diário e datas: até a conclusão. */
export function canEditSettings(status: CampaignStatus): boolean {
  return status === 'DRAFT' || status === 'READY' || status === 'ACTIVE' || status === 'PAUSED';
}

/** Campanha que ainda segura os seus leads (outra campanha não os pega). */
export function holdsLeads(status: CampaignStatus): boolean {
  return status === 'READY' || status === 'ACTIVE' || status === 'PAUSED';
}
