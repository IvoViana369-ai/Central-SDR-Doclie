import { z } from 'zod';

const id = z.uuid({ message: 'Identificador inválido.' });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const SUPPRESSION_TYPES = ['PHONE', 'EMAIL', 'INSTAGRAM', 'CNPJ'] as const;
export const SUPPRESSION_SCOPES = [
  'ALL_CHANNELS',
  'WHATSAPP',
  'INSTAGRAM',
  'EMAIL',
  'PHONE',
] as const;
export const SUPPRESSION_REASONS = [
  'OPT_OUT',
  'DATA_SUBJECT_REQUEST',
  'COMPLAINT',
  'LEGAL',
  'INVALID_CONTACT',
  'INTERNAL_DECISION',
] as const;
export const CONTACT_CHANNELS = ['ALL', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE'] as const;
export const OPT_IN_STATUSES = ['NONE', 'GRANTED', 'REVOKED'] as const;
export const OPT_IN_METHODS = [
  'INBOUND_MESSAGE',
  'FORM',
  'EVENT',
  'EXISTING_RELATIONSHIP',
  'VERBAL_RECORDED',
  'CLICK_TO_WHATSAPP',
] as const;
export const DSR_TYPES = [
  'CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'ANONYMIZATION',
  'DELETION',
  'PORTABILITY',
  'SHARING_INFO',
  'CONSENT_REVOCATION',
  'OPPOSITION',
] as const;
export const DSR_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const;

/** Inclusão manual na Lista Não Contatar por identificador (sem depender de um lead). */
export const addSuppressionInput = z.object({
  type: z.enum(SUPPRESSION_TYPES),
  value: z.string().trim().min(1, 'Informe o contato.').max(300),
  scope: z.enum(SUPPRESSION_SCOPES).default('ALL_CHANNELS'),
  reason: z.enum(SUPPRESSION_REASONS).default('OPT_OUT'),
  notes: text(500),
});

export const revokeSuppressionInput = z.object({
  suppressionId: id,
  reason: z
    .string()
    .trim()
    .min(10, 'Explique o motivo da revogação (mín. 10 caracteres).')
    .max(500),
});

export const listSuppressionsInput = z.object({
  status: z.enum(['ACTIVE', 'REVOKED', 'ALL']).default('ACTIVE'),
  type: z.enum([...SUPPRESSION_TYPES, 'LEAD']).optional(),
  /** Busca pelo valor exato (normalizado e comparado pelo hash). */
  value: z.string().trim().max(300).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createLegalBasisAssessmentInput = z.object({
  name: z.string().trim().min(3).max(120),
  legalBasis: z.enum(['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT']),
  purpose: z.string().trim().min(10).max(2000),
  documentUrl: text(500),
  approvedBy: text(120),
  approvedAt: z.coerce.date().nullish(),
  validUntil: z.coerce.date().nullish(),
});

const dsrBase = {
  requesterName: z.string().trim().min(2, 'Informe o nome do titular.').max(120),
  requesterContact: z.string().trim().min(3, 'Informe um contato do titular.').max(200),
  type: z.enum(DSR_TYPES),
  leadId: id.nullish(),
  receivedAt: z.coerce.date(),
  notes: text(2000),
};

export const createDataSubjectRequestInput = z.object(dsrBase);

export const updateDataSubjectRequestInput = z.object({
  requestId: id,
  status: z.enum(DSR_STATUSES).optional(),
  leadId: id.nullish(),
  responseSummary: text(2000),
  notes: text(2000),
});

export const listDataSubjectRequestsInput = z.object({
  status: z.enum(DSR_STATUSES).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
