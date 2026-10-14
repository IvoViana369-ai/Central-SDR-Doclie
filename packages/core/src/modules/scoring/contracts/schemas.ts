import { z } from 'zod';

const id = z.uuid({ message: 'Identificador inválido.' });

export const scoringModelIdInput = z.object({ modelId: id });
export const leadScoreInput = z.object({ leadId: id });

const bandRange = z.object({
  band: z.enum(['COLD', 'WARM', 'HOT', 'PRIORITY']),
  min: z.number().int().min(0).max(100),
  max: z.number().int().min(0).max(100),
});

/** Rascunho editado na tela de pesos (ADMIN): regras em ordem e faixas. */
export const updateScoringDraftInput = z.object({
  modelId: id,
  name: z.string().trim().min(2).max(80),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  normalization: z.enum(['CLAMP', 'SCALE']),
  bands: z.array(bandRange).length(4),
  rules: z
    .array(
      z.object({
        criterionKey: z.string().min(1).max(60),
        params: z.record(z.string(), z.unknown()).default({}),
        points: z.number().int().min(-100).max(100),
        active: z.boolean().default(true),
        description: z
          .string()
          .trim()
          .max(200)
          .nullish()
          .transform((v) => v || null),
      }),
    )
    .max(50),
});

export const priorityCityInput = z.object({
  municipalityCode: z.number().int().min(1_000_000).max(9_999_999),
  notes: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
});

export const removePriorityCityInput = z.object({
  municipalityCode: z.number().int().min(1_000_000).max(9_999_999),
});
