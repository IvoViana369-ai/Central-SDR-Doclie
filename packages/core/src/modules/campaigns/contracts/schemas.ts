import { z } from 'zod';
import { GATE_CHANNELS } from '../../compliance';
import { leadSelectionInput } from '../../leads';
import { CAMPAIGN_STATUSES } from '../domain/status';
import { INELIGIBILITY_REASONS } from '../domain/eligibility';

/** Até quatro abordagens em teste (variantes A a D). */
export const MAX_CAMPAIGN_VARIANTS = 4;
export const VARIANT_LABELS = ['A', 'B', 'C', 'D'] as const;
export const MAX_CAMPAIGN_SDRS = 20;
/** Teto do limite diário por SDR: campanha não é disparo em massa. */
export const MAX_DAILY_CONTACT_LIMIT = 200;

const id = z.uuid('Identificador inválido.');
const uniqueIds = (max: number, label: string) =>
  z
    .array(id)
    .max(max, `No máximo ${max} ${label}.`)
    .refine((ids) => new Set(ids).size === ids.length, `Há ${label} repetidos.`);

/** Ajustes que valem até a conclusão. */
const settingsShape = {
  name: z.string().trim().min(2, 'Dê um nome à campanha.').max(120),
  objective: z.string().trim().max(500).nullish(),
  /** Gestor responsável; sem ele, quem cria. */
  ownerId: id.optional(),
  dailyContactLimit: z
    .number()
    .int()
    .min(1, 'O limite diário é de pelo menos 1 lead por SDR.')
    .max(
      MAX_DAILY_CONTACT_LIMIT,
      `O limite diário é de até ${MAX_DAILY_CONTACT_LIMIT} leads por SDR.`,
    ),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
};

/** Estrutura: só antes de ativar (muda o retrato e a distribuição). */
const structureShape = {
  channel: z.enum(GATE_CHANNELS),
  /** Cadência da liberação; sem ela, a cadência padrão. */
  cadenceId: id.nullish(),
  sdrIds: uniqueIds(MAX_CAMPAIGN_SDRS, 'SDRs').refine(
    (ids) => ids.length > 0,
    'Escolha ao menos um SDR.',
  ),
  minDaysSinceLastContact: z.number().int().min(0).max(365),
  /** Abordagens em teste, na ordem das variantes (A, B…). Uma só = sem teste. */
  approachIds: uniqueIds(MAX_CAMPAIGN_VARIANTS, 'abordagens'),
  /** Filtro da lista de leads (como numa visão salva). */
  selection: leadSelectionInput,
  /** De onde veio o filtro, para exibir (ex.: nome da visão salva). */
  filterLabel: z.string().trim().max(200).nullish(),
};

function checkDates(value: { startsAt?: Date | null; endsAt?: Date | null }, ctx: z.RefinementCtx) {
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'O fim precisa ser depois do início.',
    });
  }
}

export const createCampaignInput = z
  .object({
    ...settingsShape,
    ...structureShape,
    minDaysSinceLastContact: structureShape.minDaysSinceLastContact.default(30),
    approachIds: structureShape.approachIds.default([]),
  })
  .superRefine(checkDates);
export type CreateCampaignInput = z.infer<typeof createCampaignInput>;

/** Edição: campo ausente fica como está; `null` limpa os opcionais. */
export const updateCampaignInput = z
  .object({ ...settingsShape, ...structureShape })
  .partial()
  .extend({ campaignId: id, version: z.number().int().min(1) })
  .superRefine(checkDates);
export type UpdateCampaignInput = z.infer<typeof updateCampaignInput>;

export const STRUCTURE_FIELDS = [
  'channel',
  'cadenceId',
  'sdrIds',
  'minDaysSinceLastContact',
  'approachIds',
  'selection',
  'filterLabel',
] as const satisfies readonly (keyof UpdateCampaignInput)[];

export const campaignIdInput = z.object({ campaignId: id });

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

export const campaignActionInput = z.object({
  campaignId: id,
  action: z.enum(CAMPAIGN_ACTIONS),
  version: z.number().int().min(1),
});

export const listCampaignsInput = z.object({
  /** Sem situação: todas menos as arquivadas. */
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const listCampaignLeadsInput = z.object({
  campaignId: id,
  eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE']).optional(),
  status: z.enum(['PENDING', 'RELEASED', 'SKIPPED', 'REMOVED']).optional(),
  reason: z.enum(INELIGIBILITY_REASONS).optional(),
  assignedToId: id.optional(),
  variantId: id.optional(),
  cursor: id.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const removeCampaignLeadInput = z.object({ campaignId: id, leadId: id });

export const leadCampaignsInput = z.object({ leadId: id });

/** Job `campaign.build`. */
export const campaignBuildJob = z.object({ campaignId: id });
