import type { ContactStatus, Prisma } from '@docline/db';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { CONTACT_STATUS_LABELS } from '../../compliance';
import { formatPhone } from '../../normalization';
import { leadSelectionInput, searchLeadsInput, type FilterNode } from '../contracts/filters';
import { formatLeadCode } from '../domain/lead';
import { compileLeadSelection } from '../infra/filters';
import { leadScopeWhere } from '../infra/scope';

const SORTS: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
  recent_activity: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  name: [{ nameSearch: 'asc' }, { id: 'asc' }],
  code: [{ code: 'desc' }],
};

/** Situações em que o lead pode ser contatado por ao menos um canal. */
export const CONTACTABLE_STATUSES: ContactStatus[] = ['CONTACTABLE', 'RESTRICTED'];

/** `where` completo de uma seleção: filtro + busca + escopo do ator. */
export async function selectionWhere(
  ctx: UseCaseContext,
  selection: { filter?: FilterNode; q?: string },
): Promise<Prisma.LeadWhereInput> {
  const scope = await leadScopeWhere(ctx.tx, ctx.actor);
  return { AND: [compileLeadSelection(ctx.actor, selection), scope] };
}

/** Contagem com quebra por situação de contato (MVP M03: "250 · 231 contactáveis · 19 bloqueados"). */
export async function countSelection(ctx: UseCaseContext, where: Prisma.LeadWhereInput) {
  const groups = await ctx.tx.lead.groupBy({
    by: ['contactStatus'],
    where,
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(
    groups.map((g) => [g.contactStatus, g._count._all]),
  ) as Partial<Record<ContactStatus, number>>;
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  const contactable = CONTACTABLE_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
  return { total, contactable, blocked: total - contactable, byStatus };
}

const listSelect = {
  id: true,
  code: true,
  displayName: true,
  companyName: true,
  cityRaw: true,
  stateUf: true,
  leadType: true,
  status: true,
  contactStatus: true,
  hasPhone: true,
  hasWhatsapp: true,
  hasEmail: true,
  hasInstagram: true,
  hasWebsite: true,
  lastActivityAt: true,
  createdAt: true,
  segment: { select: { name: true } },
  originSource: { select: { name: true } },
  owner: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  contactPoints: {
    where: { status: 'ACTIVE', isPrimary: true },
    select: { type: true, valueNormalized: true },
  },
} satisfies Prisma.LeadSelect;

/** Lista de leads (MVP M03): filtros, busca, ordenação e paginação por cursor, sempre no escopo do ator. */
export const searchLeads = defineUseCase({
  name: 'leads.search',
  access: 'lead.read',
  input: searchLeadsInput,
  async run(ctx, input) {
    const where = await selectionWhere(ctx, input);
    const rows = await ctx.tx.lead.findMany({
      where,
      orderBy: SORTS[input.sort],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: listSelect,
    });
    const page = rows.slice(0, input.limit);
    return {
      data: page.map(({ contactPoints, tags, ...lead }) => {
        const phone = contactPoints.find((cp) => cp.type === 'PHONE');
        const email = contactPoints.find((cp) => cp.type === 'EMAIL');
        return {
          ...lead,
          codeLabel: formatLeadCode(lead.code),
          contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
          primaryPhone: phone ? formatPhone(phone.valueNormalized) : null,
          primaryEmail: email?.valueNormalized ?? null,
          tags: tags.map((t) => t.tag),
        };
      }),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    };
  },
});

/** Contagem prévia de uma seleção (antes de qualquer ação em massa). */
export const countLeads = defineUseCase({
  name: 'leads.count',
  access: 'lead.read',
  input: leadSelectionInput,
  async run(ctx, input) {
    return countSelection(ctx, await selectionWhere(ctx, input));
  },
});
