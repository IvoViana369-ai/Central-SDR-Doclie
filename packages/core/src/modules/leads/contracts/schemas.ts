import { z } from 'zod';

/**
 * Schemas de entrada do módulo de leads (compartilhados com a API e a UI).
 * Valores de contato chegam como texto livre e são normalizados no caso de uso,
 * que devolve erros por campo (ex.: "contactPoints.1.value").
 */

const id = z.uuid({ message: 'Identificador inválido.' });

/** Texto opcional: vazio vira nulo; `undefined` significa "não alterar" no PATCH. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const LEAD_TYPES = [
  'ACCOUNTING_FIRM',
  'ACCOUNTANT',
  'REFERRAL_PARTNER',
  'COMPANY',
  'OTHER',
] as const;
export const LEGAL_BASES = ['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT', 'NOT_ASSESSED'] as const;
export const CONTACT_POINT_TYPES = ['PHONE', 'EMAIL', 'INSTAGRAM'] as const;

/** Campos editáveis do lead (cadastro e edição). */
const leadFields = {
  companyName: text(200),
  tradeName: text(200),
  leadType: z.enum(LEAD_TYPES).optional(),
  segmentId: id.nullish(),
  category: text(120),
  cnpj: text(30),
  addressLine: text(200),
  addressNumber: text(20),
  addressComplement: text(100),
  neighborhood: text(100),
  postalCode: text(12),
  /** Código IBGE do município (preenche cidade e UF). */
  municipalityCode: z.number().int().min(1_000_000).max(9_999_999).nullish(),
  /** Cidade em texto livre, quando o município não foi identificado. */
  cityRaw: text(100),
  stateUf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'UF inválida.')
    .nullish(),
  website: text(500),
  description: text(5000),
};

export const personInput = z.object({
  fullName: z.string().trim().min(2, 'Informe o nome da pessoa.').max(120, 'Nome muito longo.'),
  roleTitle: text(80),
  isPrimary: z.boolean().default(false),
  isDecisionMaker: z.boolean().default(false),
  notes: text(1000),
});

export const contactPointInput = z.object({
  type: z.enum(CONTACT_POINT_TYPES),
  value: z.string().trim().min(1, 'Informe o contato.').max(300),
  label: text(40),
  isPrimary: z.boolean().default(false),
  /** Telefone com WhatsApp informado pela fonte (fica como "provável"). */
  isWhatsapp: z.boolean().default(false),
  /** Índice da pessoa (no cadastro) ou id da pessoa (em um lead existente). */
  personIndex: z.number().int().min(0).max(19).optional(),
  personId: id.nullish(),
});

const collectedAt = z.coerce.date({ message: 'Data da coleta inválida.' });

export const createLeadInput = z.object({
  ...leadFields,
  origin: z.object({
    sourceId: id,
    detail: text(200),
    url: text(500),
    collectedAt,
    referrerName: text(120),
  }),
  legalBasis: z.enum(LEGAL_BASES),
  legalBasisAssessmentId: id.nullish(),
  /** Evidência ou observação sobre a base legal (ex.: formulário de evento). */
  legalBasisEvidence: text(500),
  people: z.array(personInput).max(20, 'Máximo de 20 pessoas.').default([]),
  contactPoints: z.array(contactPointInput).max(30, 'Máximo de 30 contatos.').default([]),
  tagIds: z.array(id).max(20).default([]),
  /** Responsável. Sem a permissão de atribuir, só é aceito o próprio usuário. */
  ownerId: id.nullish(),
  /** Confirma o cadastro mesmo com possíveis duplicados exibidos ao usuário. */
  acknowledgeDuplicates: z.boolean().default(false),
});

export const updateLeadInput = z.object({
  leadId: id,
  /** Versão lida (lock otimista). */
  version: z.number().int().min(1),
  ...leadFields,
});

export const leadIdInput = z.object({ leadId: id });

export const checkDuplicatesInput = z.object({
  cnpj: text(30),
  companyName: text(200),
  tradeName: text(200),
  municipalityCode: z.number().int().nullish(),
  website: text(500),
  contactPoints: z
    .array(z.object({ type: z.enum(CONTACT_POINT_TYPES), value: z.string().trim().max(300) }))
    .max(30)
    .default([]),
  /** Ao editar, ignora o próprio lead. */
  excludeLeadId: id.nullish(),
});

export const addPersonInput = personInput.extend({ leadId: id });
export const updatePersonInput = z.object({
  leadId: id,
  personId: id,
  fullName: z.string().trim().min(2).max(120).optional(),
  roleTitle: text(80),
  isPrimary: z.boolean().optional(),
  isDecisionMaker: z.boolean().optional(),
  notes: text(1000),
});
export const personRefInput = z.object({ leadId: id, personId: id });

export const addContactPointInput = contactPointInput
  .omit({ personIndex: true })
  .extend({ leadId: id });
export const updateContactPointInput = z.object({
  leadId: id,
  contactPointId: id,
  label: text(40),
  isPrimary: z.boolean().optional(),
  whatsappStatus: z.enum(['UNKNOWN', 'PROBABLE', 'CONFIRMED', 'NOT_ON_WHATSAPP']).optional(),
  status: z.enum(['ACTIVE', 'INVALID', 'BOUNCED', 'WRONG_PERSON']).optional(),
  personId: id.nullish(),
});
export const contactPointRefInput = z.object({ leadId: id, contactPointId: id });

export const addNoteInput = z.object({
  leadId: id,
  body: z.string().trim().min(1, 'Escreva a observação.').max(5000, 'Máximo de 5.000 caracteres.'),
  pinned: z.boolean().default(false),
});
export const noteRefInput = z.object({ leadId: id, noteId: id });
export const setNotePinnedInput = noteRefInput.extend({ pinned: z.boolean() });

export const TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;
export const createTagInput = z.object({
  name: z.string().trim().min(1, 'Informe o nome da tag.').max(40, 'Máximo de 40 caracteres.'),
  color: z.enum(TAG_COLORS).default('slate'),
  category: text(40),
});
export const updateTagInput = z.object({
  tagId: id,
  name: z.string().trim().min(1).max(40).optional(),
  color: z.enum(TAG_COLORS).optional(),
  category: text(40),
  active: z.boolean().optional(),
});
export const leadTagInput = z.object({ leadId: id, tagId: id });

export const assignLeadInput = z.object({
  leadId: id,
  /** Nulo devolve o lead ao pool. */
  ownerId: id.nullable(),
  reason: text(300),
});

export const archiveLeadInput = z.object({ leadId: id, reason: text(300) });

export const listTimelineInput = z.object({
  leadId: id,
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  types: z.array(z.string().max(60)).max(30).optional(),
});

export const setUserTerritoriesInput = z.object({
  userId: id,
  territories: z
    .array(
      z.object({
        stateUf: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, 'UF inválida.'),
        municipalityCode: z.number().int().min(1_000_000).max(9_999_999).nullish(),
      }),
    )
    .max(200),
});
export const userRefInput = z.object({ userId: id });

export type CreateLeadInput = z.input<typeof createLeadInput>;
export type UpdateLeadInput = z.input<typeof updateLeadInput>;
