import type {
  Prisma,
  SuppressionReason,
  SuppressionScope,
  SuppressionSource,
  SuppressionType,
} from '@docline/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { toJson, defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { maskIdentifier, normalizeIdentifier, type IdentifierKind } from '../../normalization';
import {
  addSuppressionInput,
  listSuppressionsInput,
  revokeSuppressionInput,
  SUPPRESSION_TYPES,
} from '../contracts/schemas';
import { refreshLeadsForIdentifiers } from '../infra/contact-state';

export interface SuppressionToCreate {
  type: SuppressionType;
  valueHash: string;
  valueMasked: string;
  scope: SuppressionScope;
  reason: SuppressionReason;
  source?: SuppressionSource;
  leadId?: string | null;
  notes?: string | null;
}

/** Origem padrão do registro conforme quem executa. */
function sourceOf(ctx: UseCaseContext): SuppressionSource {
  return ctx.actor.kind === 'user' && ctx.actor.role !== 'ADMIN' ? 'SDR' : 'ADMIN';
}

/** Evento de conformidade na timeline dos leads atingidos. */
async function recordOnLeads(
  ctx: UseCaseContext,
  leadIds: string[],
  type: 'optout.registered' | 'suppression.revoked',
  payload: Record<string, unknown>,
) {
  if (leadIds.length === 0) return;
  await ctx.tx.leadEvent.createMany({
    data: leadIds.map((leadId) => ({
      leadId,
      type,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? ('USER' as const) : ('SYSTEM' as const),
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      payload: toJson(payload),
    })),
  });
}

/**
 * Inclui identificadores na Lista Não Contatar (efeito imediato, na mesma
 * transação: docs/LGPD.md §8). Supressões vigentes iguais são mantidas, sem
 * duplicar. Recalcula a situação de contato de todos os leads atingidos.
 */
export async function suppressIdentifiers(ctx: UseCaseContext, entries: SuppressionToCreate[]) {
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  const created = await ctx.tx.suppressionEntry.createManyAndReturn({
    data: entries.map((e) => ({
      type: e.type,
      valueHash: e.valueHash,
      valueMasked: e.valueMasked,
      scope: e.scope,
      reason: e.reason,
      source: e.source ?? sourceOf(ctx),
      leadId: e.leadId ?? null,
      notes: e.notes ?? null,
      createdById: actorId,
      createdAt: ctx.now,
    })),
    // Já existe supressão vigente para o mesmo identificador e escopo: mantém a existente.
    skipDuplicates: true,
    select: { id: true, type: true, valueHash: true, valueMasked: true, scope: true, reason: true },
  });
  const leadIds = await refreshLeadsForIdentifiers(ctx.tx, entries);
  for (const entry of created) {
    await ctx.audit({
      action: 'suppression.add',
      entityType: 'suppression',
      entityId: entry.id,
      changes: { [entry.type.toLowerCase()]: [null, entry.valueMasked] },
      metadata: { scope: entry.scope, reason: entry.reason, leads: leadIds },
    });
  }
  return { created, alreadySuppressed: entries.length - created.length, leadIds };
}

export const addSuppression = defineUseCase({
  name: 'compliance.addSuppression',
  access: 'optout.register',
  input: addSuppressionInput,
  async run(ctx, input) {
    const normalized = normalizeIdentifier(input.type, input.value);
    if (!normalized.ok) throw new ValidationError([{ path: 'value', message: normalized.message }]);
    const result = await suppressIdentifiers(ctx, [
      {
        type: input.type,
        valueHash: ctx.deps.identifiers.hash(input.type, normalized.value),
        valueMasked: maskIdentifier(input.type, normalized.value),
        scope: input.scope,
        reason: input.reason,
        notes: input.notes,
      },
    ]);
    await recordOnLeads(ctx, result.leadIds, 'optout.registered', {
      type: input.type,
      scope: input.scope,
      reason: input.reason,
    });
    return {
      created: result.created.length > 0,
      alreadySuppressed: result.alreadySuppressed > 0,
      affectedLeads: result.leadIds.length,
    };
  },
});

/** Revogação: só ADMIN, com motivo (ex.: o titular pediu para voltar a receber). */
export const revokeSuppression = defineUseCase({
  name: 'compliance.revokeSuppression',
  access: 'suppression.revoke',
  input: revokeSuppressionInput,
  async run(ctx, input) {
    const entry = await ctx.tx.suppressionEntry.findUnique({ where: { id: input.suppressionId } });
    if (!entry) throw new NotFoundError('Registro não encontrado.');
    if (entry.revokedAt) throw new ConflictError('Este registro já foi revogado.');
    await ctx.tx.suppressionEntry.update({
      where: { id: entry.id },
      data: {
        revokedAt: ctx.now,
        revokedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        revokeReason: input.reason,
      },
    });
    const leadIds = await refreshLeadsForIdentifiers(ctx.tx, [entry]);
    await recordOnLeads(ctx, leadIds, 'suppression.revoked', {
      type: entry.type,
      scope: entry.scope,
      value: entry.valueMasked,
    });
    await ctx.audit({
      action: 'suppression.revoke',
      entityType: 'suppression',
      entityId: entry.id,
      changes: { revokedAt: [null, ctx.now] },
      metadata: { reason: input.reason, value: entry.valueMasked, leads: leadIds },
    });
    return { revoked: true, affectedLeads: leadIds.length };
  },
});

/** Lista Não Contatar (valores sempre mascarados), com busca pelo valor exato. */
export const listSuppressions = defineUseCase({
  name: 'compliance.listSuppressions',
  access: 'suppression.read',
  input: listSuppressionsInput,
  async run(ctx, input) {
    const where: Prisma.SuppressionEntryWhereInput = {
      ...(input.status === 'ACTIVE' ? { revokedAt: null } : {}),
      ...(input.status === 'REVOKED' ? { revokedAt: { not: null } } : {}),
      ...(input.type ? { type: input.type } : {}),
    };
    if (input.value) {
      const kinds: IdentifierKind[] =
        input.type && input.type !== 'LEAD' ? [input.type] : [...SUPPRESSION_TYPES];
      const hashes = kinds.flatMap((kind) => {
        const normalized = normalizeIdentifier(kind, input.value!);
        return normalized.ok
          ? [{ type: kind, valueHash: ctx.deps.identifiers.hash(kind, normalized.value) }]
          : [];
      });
      if (hashes.length === 0) return { data: [], nextCursor: null };
      where.OR = hashes;
    }
    const rows = await ctx.tx.suppressionEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        valueMasked: true,
        scope: true,
        reason: true,
        source: true,
        notes: true,
        createdAt: true,
        createdById: true,
        revokedAt: true,
        revokedById: true,
        revokeReason: true,
        lead: { select: { id: true, code: true, displayName: true, status: true } },
      },
    });
    const page = rows.slice(0, input.limit);
    const userIds = [
      ...new Set(
        page.flatMap((r) => [r.createdById, r.revokedById]).filter((v): v is string => !!v),
      ),
    ];
    const users = userIds.length
      ? await ctx.tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      data: page.map((r) => ({
        ...r,
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
        revokedByName: r.revokedById ? (names.get(r.revokedById) ?? null) : null,
      })),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    };
  },
});
