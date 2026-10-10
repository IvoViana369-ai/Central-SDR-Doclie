import { z } from 'zod';
import { MERGE_FIELD_KEYS, type MergeField } from '../domain/merge';
import type { DuplicateRule } from '../domain/scoring';

const id = z.uuid({ message: 'Identificador inválido.' });

const RULES = [
  'CNPJ',
  'CNPJ_ROOT',
  'PHONE',
  'EMAIL',
  'EMAIL_FREE',
  'INSTAGRAM',
  'WEBSITE',
  'NAME_CITY',
  'NAME_SIMILAR',
] as const satisfies readonly DuplicateRule[];

export const listDuplicatesInput = z.object({
  status: z.enum(['PENDING', 'IGNORED', 'KEPT_SEPARATE', 'MERGED']).default('PENDING'),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  rule: z.enum(RULES).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const duplicateIdInput = z.object({ candidateId: id });

const note = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null);

export const decideDuplicateInput = z.object({ candidateId: id, note });

const choices = z
  .record(z.string(), z.enum(['survivor', 'merged']))
  .refine(
    (value) => Object.keys(value).every((k) => (MERGE_FIELD_KEYS as string[]).includes(k)),
    'Campo de mesclagem inválido.',
  )
  .transform((value) => value as Partial<Record<MergeField, 'survivor' | 'merged'>>);

export const mergeDuplicateInput = z.object({
  candidateId: id,
  /** Lead que continua; o outro vira MERGED e aponta para ele. */
  survivorId: id,
  /** Campo a campo; o que não vier segue o padrão (valor do sobrevivente, ou o do outro se vazio). */
  choices: choices.default({}),
  /** Versões lidas na tela de comparação (lock otimista dos dois leads). */
  versions: z.object({ survivor: z.number().int(), merged: z.number().int() }).optional(),
  note,
});
