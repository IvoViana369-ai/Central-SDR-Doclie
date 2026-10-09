import { z } from 'zod';

/**
 * Linguagem de filtros da lista de leads (docs/ARCHITECTURE.md §9.1): grupos
 * `all`/`any` aninháveis de condições sobre uma lista fechada de campos. O
 * servidor compila para consultas do Prisma; nada vira SQL concatenado.
 * Etapa, score e duplicados entram nas Fases 3–4.
 */

export const FILTER_FIELDS = [
  'state',
  'city',
  'segment',
  'leadType',
  'origin',
  'owner',
  'status',
  'contactStatus',
  'hasPhone',
  'hasWhatsapp',
  'hasEmail',
  'hasInstagram',
  'hasWebsite',
  'hasCnpj',
  'tags',
  'name',
  'createdAt',
  'lastActivityAt',
  'collectedAt',
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPS = [
  'eq',
  'in',
  'isNull',
  'hasAny',
  'hasAll',
  'hasNone',
  'contains',
  'gte',
  'lte',
  'between',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterCondition {
  field: FilterField;
  op: FilterOp;
  value?: unknown;
}
export type FilterNode = FilterCondition | { all: FilterNode[] } | { any: FilterNode[] };

export const filterConditionSchema = z.object({
  field: z.enum(FILTER_FIELDS),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    filterConditionSchema,
    z.object({ all: z.array(filterNodeSchema).max(50) }),
    z.object({ any: z.array(filterNodeSchema).max(50) }),
  ]),
);

export const LEAD_SORTS = ['recent_activity', 'newest', 'oldest', 'name', 'code'] as const;

/** Seleção de leads: filtro + busca livre (por nome, código, CNPJ, telefone, e-mail ou Instagram). */
export const leadSelectionInput = z.object({
  filter: filterNodeSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

export const searchLeadsInput = leadSelectionInput.extend({
  sort: z.enum(LEAD_SORTS).default('recent_activity'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const BULK_ACTIONS = ['assign', 'addTag', 'removeTag'] as const;

export const bulkLeadsInput = z.object({
  action: z.enum(BULK_ACTIONS),
  /** Leads escolhidos um a um ou todos os que atendem ao filtro. */
  target: z.union([
    z.object({ ids: z.array(z.uuid()).min(1).max(5000) }),
    leadSelectionInput.extend({ mode: z.literal('filter') }),
  ]),
  params: z.object({
    ownerId: z.uuid().nullable().optional(),
    tagId: z.uuid().optional(),
    reason: z.string().trim().max(300).optional(),
  }),
  /** Simulação: devolve a contagem e o token de confirmação, sem alterar nada. */
  dryRun: z.boolean().default(true),
  /** Token devolvido pela simulação; obrigatório para executar. */
  confirmationToken: z.string().max(200).optional(),
});

export const saveViewInput = z.object({
  name: z.string().trim().min(1, 'Dê um nome à visão.').max(60),
  filter: filterNodeSchema.optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(LEAD_SORTS).default('recent_activity'),
  columns: z.array(z.string().max(40)).max(30).optional(),
  shared: z.boolean().default(false),
});
export const updateViewInput = saveViewInput.partial().extend({ viewId: z.uuid() });
export const viewRefInput = z.object({ viewId: z.uuid() });
