import { createHash } from 'node:crypto';
import type { Prisma } from '@docline/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import {
  auditData,
  defineUseCase,
  requirePermission,
  toJson,
  type AuditEntry,
  type UseCaseContext,
} from '../../../shared/use-case';
import { bulkLeadsInput } from '../contracts/filters';
import { LEAD_EVENTS, type LeadEventType } from '../domain/events';
import { maskSearchText } from '../infra/filters';
import { leadScopeWhere } from '../infra/scope';
import { resolveOwner } from './create-lead';
import { countSelection, selectionWhere } from './search';

/** Limite por ação em massa (acima disso, refine o filtro). */
export const BULK_LIMIT = 5000;

type BulkInput = typeof bulkLeadsInput._zod.output;

/**
 * Token de confirmação: liga a execução ao que o usuário viu na simulação
 * (mesma ação, mesmos parâmetros, mesmos leads). Se a seleção mudar entre a
 * simulação e a confirmação, a execução é recusada.
 */
function confirmationToken(actorKey: string, input: BulkInput, ids: string[]): string {
  const payload = JSON.stringify([actorKey, input.action, input.params, [...ids].sort()]);
  return createHash('sha256').update(payload).digest('base64url');
}

async function targetWhere(ctx: UseCaseContext, input: BulkInput): Promise<Prisma.LeadWhereInput> {
  const editable: Prisma.LeadWhereInput = { status: { in: ['ACTIVE', 'ARCHIVED'] } };
  if ('ids' in input.target) {
    const scope = await leadScopeWhere(ctx.tx, ctx.actor);
    return { AND: [{ id: { in: input.target.ids } }, scope, editable] };
  }
  return { AND: [await selectionWhere(ctx, input.target), editable] };
}

interface LeadEffect {
  leadId: string;
  payload: Record<string, unknown>;
  changes: AuditEntry['changes'];
}

/** Eventos, auditoria e "última atividade" de vários leads, em lote (poucas consultas). */
async function writeLeadEffects(
  ctx: UseCaseContext,
  effects: LeadEffect[],
  eventType: LeadEventType,
  action: string,
) {
  if (effects.length === 0) return;
  const actorType = ctx.actor.kind === 'user' ? ('USER' as const) : ('SYSTEM' as const);
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  await ctx.tx.leadEvent.createMany({
    data: effects.map((e) => ({
      leadId: e.leadId,
      type: eventType,
      occurredAt: ctx.now,
      actorType,
      actorId,
      payload: toJson({ ...e.payload, bulk: true }),
    })),
  });
  await ctx.tx.auditLog.createMany({
    data: effects.map((e) => ({
      ...auditData(ctx.actor, ctx.meta, {
        action,
        entityType: 'lead',
        entityId: e.leadId,
        changes: e.changes,
        metadata: { bulk: true },
      }),
      occurredAt: ctx.now,
    })),
  });
  await ctx.tx.lead.updateMany({
    where: { id: { in: effects.map((e) => e.leadId) } },
    data: { lastActivityAt: ctx.now },
  });
}

/**
 * Ação em massa (MVP M03): atribuir responsável e adicionar/remover tag, sobre
 * leads escolhidos ou sobre um filtro, sempre no escopo do ator. Exige
 * simulação antes (`dryRun`), com contagem "selecionados · contactáveis ·
 * bloqueados" e token de confirmação.
 */
export const bulkLeads = defineUseCase({
  name: 'leads.bulk',
  access: 'lead.bulk',
  input: bulkLeadsInput,
  async run(ctx, input) {
    if (input.action === 'assign') {
      await requirePermission(ctx, 'lead.assign');
      if (input.params.ownerId === undefined) {
        throw new ValidationError([{ path: 'params.ownerId', message: 'Escolha o responsável.' }]);
      }
    }
    let tag: { id: string; name: string } | null = null;
    if (input.action === 'addTag' || input.action === 'removeTag') {
      if (!input.params.tagId) {
        throw new ValidationError([{ path: 'params.tagId', message: 'Escolha a tag.' }]);
      }
      tag = await ctx.tx.tag.findFirst({
        where: { id: input.params.tagId, ...(input.action === 'addTag' ? { active: true } : {}) },
        select: { id: true, name: true },
      });
      if (!tag) throw new NotFoundError('Tag não encontrada.');
    }
    const ownerId =
      input.action === 'assign'
        ? await resolveOwner(ctx, input.params.ownerId ?? null, 'params.ownerId')
        : null;

    const where = await targetWhere(ctx, input);
    const leads = await ctx.tx.lead.findMany({
      where,
      select: {
        id: true,
        ownerId: true,
        tags: tag ? { where: { tagId: tag.id }, select: { tagId: true } } : false,
      },
      orderBy: { id: 'asc' },
      take: BULK_LIMIT + 1,
    });
    if (leads.length > BULK_LIMIT) {
      throw new BusinessRuleError(
        `A seleção passa de ${BULK_LIMIT.toLocaleString('pt-BR')} leads. Refine o filtro.`,
      );
    }
    const ids = leads.map((l) => l.id);
    const toChange = leads.filter((l) => {
      if (input.action === 'assign') return l.ownerId !== ownerId;
      const hasTag = (l.tags?.length ?? 0) > 0;
      return input.action === 'addTag' ? !hasTag : hasTag;
    });
    const breakdown = await countSelection(ctx, { id: { in: ids } });
    const actorKey = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.kind;
    const token = confirmationToken(actorKey, input, ids);
    const summary = {
      ...breakdown,
      willChange: toChange.length,
      ...('ids' in input.target ? { notFound: input.target.ids.length - ids.length } : {}),
    };
    if (input.dryRun) return { dryRun: true as const, ...summary, confirmationToken: token };

    if (input.confirmationToken !== token) {
      throw new ConflictError(
        'A seleção mudou desde a simulação. Confira de novo antes de confirmar.',
      );
    }
    const changeIds = toChange.map((l) => l.id);
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;

    if (input.action === 'assign' && changeIds.length > 0) {
      await ctx.tx.$executeRaw`
        UPDATE leads
        SET previous_owner_id = owner_id, owner_id = ${ownerId}::uuid,
            assigned_at = ${ownerId ? ctx.now : null}, version = version + 1
        WHERE id = ANY(${changeIds}::uuid[])`;
      await ctx.tx.leadAssignment.createMany({
        data: toChange.map((l) => ({
          leadId: l.id,
          fromUserId: l.ownerId,
          toUserId: ownerId,
          strategy: 'MANUAL' as const,
          assignedById: actorId,
          reason: input.params.reason ?? null,
          assignedAt: ctx.now,
        })),
      });
      // Um evento e uma auditoria por lead, com o responsável anterior de cada um.
      await writeLeadEffects(
        ctx,
        toChange.map((l) => ({
          leadId: l.id,
          payload: { fromUserId: l.ownerId, toUserId: ownerId, strategy: 'MANUAL' },
          changes: { ownerId: [l.ownerId, ownerId] },
        })),
        LEAD_EVENTS.ownerAssigned,
        'lead.assign',
      );
    }
    if (input.action === 'addTag' && tag && changeIds.length > 0) {
      await ctx.tx.leadTag.createMany({
        data: changeIds.map((leadId) => ({ leadId, tagId: tag.id, addedById: actorId })),
        skipDuplicates: true,
      });
      await writeLeadEffects(
        ctx,
        changeIds.map((leadId) => ({
          leadId,
          payload: { tagId: tag.id, name: tag.name },
          changes: { tag: [null, tag.name] },
        })),
        LEAD_EVENTS.tagAdded,
        'lead.tag.add',
      );
    }
    if (input.action === 'removeTag' && tag && changeIds.length > 0) {
      await ctx.tx.leadTag.deleteMany({ where: { tagId: tag.id, leadId: { in: changeIds } } });
      await writeLeadEffects(
        ctx,
        changeIds.map((leadId) => ({
          leadId,
          payload: { tagId: tag.id, name: tag.name },
          changes: { tag: [tag.name, null] },
        })),
        LEAD_EVENTS.tagRemoved,
        'lead.tag.remove',
      );
    }

    await ctx.audit({
      action: 'lead.bulk',
      entityType: 'lead_bulk',
      entityId: null,
      metadata: {
        bulkAction: input.action,
        selected: ids.length,
        changed: changeIds.length,
        target: 'ids' in input.target ? 'ids' : 'filter',
        ...('ids' in input.target
          ? {}
          : { filter: input.target.filter ?? null, q: maskSearchText(input.target.q) }),
        ...(input.action === 'assign' ? { ownerId } : { tagId: tag?.id }),
      },
    });
    return { dryRun: false as const, ...summary, changed: changeIds.length };
  },
});
