import { z } from 'zod';
import { OUTREACH_KINDS } from '../domain/kinds';
import { aiRulesSchema } from '../domain/rules';

const id = z.uuid({ message: 'Identificador inválido.' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => v || null);

/** Canais do contato assistido (onde um rascunho pode ser enviado). */
export const AI_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'EMAIL'] as const;

/** Gerar abordagem com IA (M12). */
export const generateOutreachInput = z.object({
  leadId: id,
  kind: z.enum(OUTREACH_KINDS),
  channel: z.enum(AI_CHANNELS).default('WHATSAPP'),
  approachId: id.nullish(),
  /** Orientação livre do SDR para este rascunho (sem dados de contato). */
  instructions: text(500),
  /** Gerar de novo: o rascunho anterior fica descartado ("regenerada"). */
  replacesGenerationId: id.nullish(),
});

export const generationIdInput = z.object({ generationId: id });

export const editGenerationInput = z.object({
  generationId: id,
  text: z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
});

/** Aprovar e preparar o envio assistido (o texto aprovado é o que vai). */
export const approveGenerationInput = z.object({
  generationId: id,
  text: z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
  contactPointId: id.nullish(),
  taskId: id.nullish(),
});

export const discardGenerationInput = z.object({
  generationId: id,
  reason: z.string().trim().min(2, 'Diga por que descartou.').max(300),
});

export const rateGenerationInput = z.object({
  generationId: id,
  rating: z.number().int().min(1).max(5),
  feedback: text(1000),
});

export const leadGenerationsInput = z.object({ leadId: id });

export const suggestClassificationInput = z.object({ messageId: id });

const key = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .transform((v) =>
    v
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
  );

/** Fato aprovado da Docline (ADMIN): cada mudança de conteúdo sobe a versão. */
export const upsertKnowledgeInput = z.object({
  key,
  title: z.string().trim().min(2).max(120),
  content: z.string().trim().min(5).max(2000),
  active: z.boolean().default(true),
});

export const createApproachInput = z.object({
  key,
  name: z.string().trim().min(2).max(80),
  description: text(300),
  hypothesis: text(300),
  guidance: text(800),
  active: z.boolean().default(true),
});

export const updateApproachInput = createApproachInput.omit({ key: true }).extend({
  approachId: id,
});

export const updateAiRulesInput = aiRulesSchema;

/** Custos da IA no mês (AAAA-MM; padrão: o mês corrente). */
export const aiUsageInput = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM.')
    .optional(),
});
