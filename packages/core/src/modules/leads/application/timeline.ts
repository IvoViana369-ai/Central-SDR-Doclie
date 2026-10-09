import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { listTimelineInput } from '../contracts/schemas';
import { LEAD_EVENT_LABELS, type LeadEventType } from '../domain/events';
import { requireLeadInScope } from '../infra/scope';

async function userNames(ctx: UseCaseContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map<string, string>();
  const users = await ctx.tx.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Timeline do lead (MVP M09): eventos em ordem cronológica inversa, com ator e filtro por tipo. */
export const listLeadTimeline = defineUseCase({
  name: 'leads.timeline',
  access: 'lead.read',
  input: listTimelineInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.leadEvent.findMany({
      where: {
        leadId: input.leadId,
        ...(input.types?.length ? { type: { in: input.types } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        occurredAt: true,
        actorType: true,
        actorId: true,
        payload: true,
        subjectType: true,
        subjectId: true,
        channel: true,
      },
    });
    const page = rows.slice(0, input.limit);
    const names = await userNames(
      ctx,
      page.flatMap((e) => {
        const payload = (e.payload ?? {}) as {
          fromUserId?: string | null;
          toUserId?: string | null;
          salesOwnerId?: string | null;
        };
        return [
          e.actorId,
          payload.fromUserId ?? null,
          payload.toUserId ?? null,
          payload.salesOwnerId ?? null,
        ];
      }),
    );
    return {
      data: page.map((e) => ({
        ...e,
        label: LEAD_EVENT_LABELS[e.type as LeadEventType] ?? e.type,
        actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
      })),
      /** Nomes dos usuários citados nos payloads (ex.: responsáveis). */
      users: Object.fromEntries(names),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    };
  },
});

/**
 * Histórico de alterações de campos (MVP M02): a auditoria filtrada pelo lead,
 * sem IP e user agent (esses ficam só na tela de Auditoria, para o ADMIN).
 */
export const listLeadHistory = defineUseCase({
  name: 'leads.history',
  access: 'lead.read',
  input: listTimelineInput.omit({ types: true }),
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.auditLog.findMany({
      where: { entityType: 'lead', entityId: input.leadId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        occurredAt: true,
        action: true,
        actorType: true,
        actorId: true,
        changes: true,
        metadata: true,
      },
    });
    const page = rows.slice(0, input.limit);
    const names = await userNames(
      ctx,
      page.map((r) => r.actorId),
    );
    return {
      data: page.map((r) => ({
        ...r,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      })),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    };
  },
});
