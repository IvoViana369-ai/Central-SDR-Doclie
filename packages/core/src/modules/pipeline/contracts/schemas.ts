import { z } from 'zod';
import { leadSelectionInput, TAG_COLORS } from '../../leads';

const id = z.uuid({ message: 'Identificador inválido.' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const moveLeadStageInput = z.object({
  leadId: id,
  stageId: id,
  /** Versão do lead lida no quadro (lock otimista). */
  version: z.number().int().min(1),
  lossReasonId: id.nullish(),
  note: text(500),
});

/** Quadro: mesmas seleções da lista de leads (filtro DSL + busca). */
export const pipelineBoardInput = leadSelectionInput.extend({
  pipelineId: id.optional(),
  perColumn: z.coerce.number().int().min(1).max(50).default(20),
});

export const stageCardsInput = leadSelectionInput.extend({
  pipelineId: id.optional(),
  stageId: id,
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const leadStageHistoryInput = z.object({ leadId: id });

export const pipelineIdInput = z.object({ pipelineId: id.optional() });

const stageName = z
  .string()
  .trim()
  .min(1, 'Informe o nome da etapa.')
  .max(40, 'Máximo de 40 caracteres.');

/**
 * Configuração das etapas (ADMIN): a ordem da lista é a ordem no quadro.
 * Etapas novas não têm `id`; as existentes não podem sumir da lista.
 */
export const updateStagesInput = z.object({
  pipelineId: id.optional(),
  stages: z
    .array(
      z.object({
        id: id.optional(),
        name: stageName,
        color: z.enum(TAG_COLORS),
        slaHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .nullish(),
        active: z.boolean().default(true),
        description: text(200),
        /** Só para etapas novas (a categoria das existentes não muda). */
        category: z.enum(['OPEN', 'LOST', 'PARKED']).optional(),
      }),
    )
    .min(2)
    .max(40),
});

export const listLossReasonsInput = z.object({ stageKey: z.string().max(60).optional() });
