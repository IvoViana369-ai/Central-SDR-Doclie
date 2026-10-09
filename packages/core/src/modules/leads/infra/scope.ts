import type { DbTransaction, Prisma } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { auditData, type UseCaseContext } from '../../../shared/use-case';

/**
 * Escopo de leads por perfil (docs/SECURITY.md §4.1), aplicado em TODA leitura
 * e escrita de lead (previne IDOR):
 *
 * - ADMIN e GESTOR: todos. Enquanto não houver gestão de equipes, o gestor vê
 *   todos os leads (decisão registrada no SECURITY.md §4.1).
 * - SDR: os seus + o pool não atribuído (ativo) dos seus territórios. Sem
 *   território configurado, não há pool: só os leads atribuídos a ele.
 * - COMERCIAL: os atribuídos a ele.
 * - Processos internos (worker, CLI): todos.
 */
export async function leadScopeWhere(
  tx: DbTransaction,
  actor: Actor,
): Promise<Prisma.LeadWhereInput> {
  if (actor.kind !== 'user') return {};
  switch (actor.role) {
    case 'ADMIN':
    case 'MANAGER':
      return {};
    case 'SALES':
      return { ownerId: actor.id };
    case 'SDR': {
      const territories = await tx.userTerritory.findMany({
        where: { userId: actor.id },
        select: { stateUf: true, municipalityCode: true },
      });
      if (territories.length === 0) return { ownerId: actor.id };
      const pool: Prisma.LeadWhereInput[] = territories.map((t) =>
        t.municipalityCode === null
          ? { stateUf: t.stateUf }
          : { municipalityCode: t.municipalityCode },
      );
      return { OR: [{ ownerId: actor.id }, { ownerId: null, status: 'ACTIVE', OR: pool }] };
    }
  }
}

/** O lead está no pool não atribuído visível ao SDR? */
export function isPoolLead(lead: { ownerId: string | null; status: string }): boolean {
  return lead.ownerId === null && lead.status === 'ACTIVE';
}

/**
 * Carrega um lead dentro do escopo do ator. Fora do escopo, responde como se o
 * lead não existisse (não revela que existe) e registra a tentativa na
 * auditoria, fora da transação, para que o registro sobreviva ao rollback
 * (aceite do MVP M01).
 */
export async function requireLeadInScope<S extends Prisma.LeadSelect>(
  ctx: UseCaseContext,
  leadId: string,
  select: S,
): Promise<Prisma.LeadGetPayload<{ select: S }>> {
  const scope = await leadScopeWhere(ctx.tx, ctx.actor);
  const lead = await ctx.tx.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select });
  if (lead) return lead as Prisma.LeadGetPayload<{ select: S }>;

  const exists = await ctx.tx.lead.count({ where: { id: leadId } });
  if (exists > 0) {
    await ctx.deps.db.auditLog.create({
      data: auditData(ctx.actor, ctx.meta, {
        action: 'access.denied',
        entityType: 'lead',
        entityId: leadId,
        metadata: { reason: 'out_of_scope' },
      }),
    });
  }
  throw new NotFoundError('Lead não encontrado.');
}

/** Lead no escopo e ainda editável (mesclados e anonimizados são só leitura). */
export async function requireEditableLead<S extends Prisma.LeadSelect>(
  ctx: UseCaseContext,
  leadId: string,
  select: S,
) {
  const lead = await requireLeadInScope(ctx, leadId, { ...select, status: true as const });
  const { status } = lead as unknown as { status: string };
  if (status === 'MERGED' || status === 'ANONYMIZED') {
    throw new ConflictError('Este lead não pode mais ser editado.');
  }
  return lead;
}
