import { z } from 'zod';
import { defineUseCase } from '../../../shared/use-case';

export const listAuditLogsInput = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  /** Cursor = id do último item recebido (UUIDv7 é ordenado no tempo). */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListAuditLogsInput = z.input<typeof listAuditLogsInput>;

export const listAuditLogs = defineUseCase({
  name: 'audit.list',
  access: 'audit.read',
  input: listAuditLogsInput,
  async run(ctx, input) {
    const rows = await ctx.tx.auditLog.findMany({
      where: {
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: input.actorId,
        action: input.action,
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;

    const actorIds = [
      ...new Set(items.map((r) => r.actorId).filter((v): v is string => Boolean(v))),
    ];
    const actors = await ctx.tx.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.name]));

    return {
      data: items.map((row) => ({
        ...row,
        actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      })),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  },
});
