import { z } from 'zod';
import { ACCOUNTING_CNAES } from '../domain/receita';

/** Máximo de resultados por busca (a tela mostra todos de uma vez). */
export const PROSPECTING_MAX_RESULTS = 500;
/** Aprovações por pedido: cada uma vira um cadastro completo, em transação própria. */
export const PROSPECTING_APPROVE_LIMIT = 100;
/** Os resultados das buscas são temporários (docs/LGPD.md §12). */
export const PROSPECTING_RETENTION_DAYS = 30;

const id = z.uuid('Identificador inválido.');
const uf = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'UF inválida.');

/** Busca na base aberta do CNPJ (F9-02). */
export const searchProspectsInput = z.object({
  uf,
  /** Cidades (código do IBGE); vazio = a UF inteira. */
  municipalityCodes: z.array(z.number().int().positive()).max(20).default([]),
  /** Só uma das atividades de contabilidade; sem ela, as duas. */
  cnae: z.enum(ACCOUNTING_CNAES).nullish(),
  headOfficeOnly: z.boolean().default(true),
  /** Deixa de fora quem já é lead (mesmo CNPJ) e quem foi recusado nos últimos 30 dias. */
  onlyNew: z.boolean().default(true),
  /** Parte do nome (fantasia ou razão social). */
  name: z.string().trim().max(100).nullish(),
  limit: z.number().int().min(1).max(PROSPECTING_MAX_RESULTS).default(100),
});
export type SearchProspectsInput = z.infer<typeof searchProspectsInput>;

export const prospectingSearchIdInput = z.object({ searchId: id });

export const listProspectingSearchesInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export const approveProspectsInput = z.object({
  searchId: id,
  resultIds: z
    .array(id)
    .min(1, 'Selecione ao menos um resultado.')
    .max(PROSPECTING_APPROVE_LIMIT, `Aprove no máximo ${PROSPECTING_APPROVE_LIMIT} de cada vez.`),
  /** Responsável dos leads novos; sem ele, ficam sem responsável (pool). */
  ownerId: id.nullish(),
  tagIds: z.array(id).max(10).default([]),
  /** Avaliação de legítimo interesse (LIA) que cobre a prospecção. */
  legalBasisAssessmentId: id.nullish(),
});

export const approveProspectInput = approveProspectsInput
  .omit({ resultIds: true })
  .extend({ resultId: id });

export const rejectProspectsInput = z.object({
  searchId: id,
  resultIds: z.array(id).min(1, 'Selecione ao menos um resultado.').max(500),
  reason: z.string().trim().max(200).nullish(),
});

export const prospectingPotentialInput = z.object({ uf });

export const leadRegistryInput = z.object({ leadId: id });
