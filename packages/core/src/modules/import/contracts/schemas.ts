import { z } from 'zod';
import { IMPORT_FIELD_KEYS, type ColumnTarget } from '../domain/fields';

const COLUMN_TARGETS = new Set<string>([...IMPORT_FIELD_KEYS, 'custom', 'ignore']);

const id = z.uuid({ message: 'Identificador inválido.' });

export const createImportInput = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => /\.(csv|txt|xlsx)$/i.test(name), 'Envie um arquivo .csv ou .xlsx.'),
  content: z.instanceof(Uint8Array),
  /** Aba do XLSX (padrão: a primeira visível). */
  sheet: z.string().trim().max(100).nullish(),
});

export const importBatchIdInput = z.object({ batchId: id });

export const columnMappingInput = z.object({
  index: z.number().int().min(0).max(999),
  header: z.string().max(200),
  target: z.custom<ColumnTarget>(
    (value) => typeof value === 'string' && COLUMN_TARGETS.has(value),
    'Destino de coluna inválido.',
  ),
  customKey: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use letras minúsculas, números e "_".')
    .optional(),
});

export const configureImportInput = z.object({
  batchId: id,
  headerRow: z.number().int().min(1),
  columns: z.array(columnMappingInput).min(1).max(1000),
  duplicatePolicy: z.enum(['CREATE_AND_FLAG', 'SKIP', 'UPDATE_EMPTY_FIELDS']),
  sourceId: id,
  sourceDetail: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  collectedAt: z.coerce.date({ message: 'Data da coleta inválida.' }),
  legalBasis: z.enum(['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT', 'NOT_ASSESSED']),
  legalBasisAssessmentId: id.nullish(),
  ownerId: id.nullish(),
  tagIds: z.array(id).max(20).default([]),
  /** Salva o mapeamento como modelo reutilizável. */
  saveTemplateAs: z.string().trim().min(2).max(80).nullish(),
});

export const importPreviewInput = z.object({
  batchId: id,
  matchStatus: z
    .enum(['NEW', 'EXISTING', 'POSSIBLE_DUPLICATE', 'DUPLICATE_IN_FILE', 'SUPPRESSED', 'INVALID'])
    .optional(),
  /** Só linhas com avisos ou erros. */
  withIssues: z.coerce.boolean().optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const decision = z.enum(['IMPORT', 'SKIP', 'LINK_EXISTING', 'UPDATE_EXISTING']);

export const setRowDecisionInput = z.object({ batchId: id, rowId: id, decision });

/** Mesma decisão para todas as linhas de uma situação (ex.: pular os possíveis duplicados). */
export const setDecisionsByStatusInput = z.object({
  batchId: id,
  matchStatus: z.enum(['NEW', 'EXISTING', 'POSSIBLE_DUPLICATE', 'DUPLICATE_IN_FILE', 'SUPPRESSED']),
  decision,
});

export const listImportsInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
