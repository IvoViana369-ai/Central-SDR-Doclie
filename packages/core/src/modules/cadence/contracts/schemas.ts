import { z } from 'zod';
import { CADENCE_ACTIONS, CADENCE_CHANNELS, CADENCE_MESSAGE_TYPES } from '../domain/options';

const id = z.uuid({ message: 'Identificador inválido.' });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => v || null);

/** Inscrever o lead (padrão: a cadência padrão). */
export const enrollLeadInput = z.object({ leadId: id, cadenceId: id.optional() });

export const leadCadenceInput = z.object({ leadId: id });

export const pauseCadenceInput = z.object({
  leadId: id,
  /** Retomar automaticamente nesta data (opcional). */
  until: z.coerce.date().nullish(),
});

export const stopCadenceInput = z.object({ leadId: id, reason: text(300) });

export const skipStepInput = z.object({ taskId: id, reason: text(300) });

/** Configuração de uma cadência (ADMIN): regras e passos na ordem. */
export const cadenceConfigInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome à cadência.').max(80),
  description: text(300),
  active: z.boolean().default(true),
  stopOnReply: z.boolean().default(true),
  useBusinessDays: z.boolean().default(true),
  sendWindowStart: hhmm,
  sendWindowEnd: z.union([hhmm, z.literal('24:00')]),
  noResponseAfterDays: z.number().int().min(1).max(60),
  steps: z
    .array(
      z.object({
        dayOffset: z.number().int().min(0).max(365),
        channel: z.enum(CADENCE_CHANNELS).default('WHATSAPP'),
        action: z.enum(CADENCE_ACTIONS).default('ASSISTED_MESSAGE'),
        messageType: z.enum(CADENCE_MESSAGE_TYPES),
        targetStageKey: z
          .string()
          .trim()
          .max(60)
          .nullish()
          .transform((v) => v || null),
        instructions: text(500),
      }),
    )
    .min(1, 'A cadência precisa de ao menos um passo.')
    .max(15),
});

export const updateCadenceInput = cadenceConfigInput.extend({ cadenceId: id });
export const cadenceIdInput = z.object({ cadenceId: id });
