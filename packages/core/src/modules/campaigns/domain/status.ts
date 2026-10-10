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
  // Inapto na montagem ou na hora de liberar (com os motivos).
  SKIPPED: 'Não liberado',
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

export const CAMPAIGN_ACTIONS = [
  'build',
  'activate',
  'pause',
  'resume',
  'complete',
  'archive',
] as const;
export type CampaignAction = (typeof CAMPAIGN_ACTIONS)[number];

export const CAMPAIGN_ACTION_LABELS: Record<CampaignAction, string> = {
  build: 'Montar',
  activate: 'Ativar',
  pause: 'Pausar',
  resume: 'Retomar',
  complete: 'Concluir',
  archive: 'Arquivar',
};

export const CAMPAIGN_ACTION_TARGET: Record<CampaignAction, CampaignStatus> = {
  build: 'BUILDING',
  activate: 'ACTIVE',
  pause: 'PAUSED',
  resume: 'ACTIVE',
  complete: 'COMPLETED',
  archive: 'ARCHIVED',
};

/** Ações possíveis na situação (ativar só da "pronta"; retomar só da "pausada"). */
export function availableActions(status: CampaignStatus): CampaignAction[] {
  return CAMPAIGN_ACTIONS.filter(
    (action) =>
      canTransition(status, CAMPAIGN_ACTION_TARGET[action]) &&
      (action !== 'activate' || status === 'READY') &&
      (action !== 'resume' || status === 'PAUSED'),
  );
}

// --- Limites -----------------------------------------------------------------

/** Até quatro abordagens em teste (variantes A a D). */
export const MAX_CAMPAIGN_VARIANTS = 4;
export const VARIANT_LABELS = ['A', 'B', 'C', 'D'] as const;
export const MAX_CAMPAIGN_SDRS = 20;
/** Teto do limite diário por SDR: campanha não é disparo em massa. */
export const MAX_DAILY_CONTACT_LIMIT = 200;

/** Campanha que ainda segura os seus leads (outra campanha não os pega). */
export function holdsLeads(status: CampaignStatus): boolean {
  return status === 'READY' || status === 'ACTIVE' || status === 'PAUSED';
}
