import { z } from 'zod';
import { BusinessRuleError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';

/** Avisos do usuário: os não lidos primeiro, depois os mais recentes. */
export const listMyNotifications = defineUseCase({
  name: 'notifications.mine',
  access: 'authenticated',
  input: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
  async run(ctx, input) {
    if (ctx.actor.kind !== 'user') return { unread: 0, items: [] };
    const [unread, items] = await Promise.all([
      ctx.tx.notification.count({ where: { userId: ctx.actor.id, readAt: null } }),
      ctx.tx.notification.findMany({
        where: { userId: ctx.actor.id },
        orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
        take: input.limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
    ]);
    return { unread, items };
  },
});

/** Marca avisos como lidos (os informados ou todos). */
export const markNotificationsRead = defineUseCase({
  name: 'notifications.markRead',
  access: 'authenticated',
  input: z.object({ ids: z.array(z.uuid()).max(100).optional() }),
  async run(ctx, input) {
    if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
    const { count } = await ctx.tx.notification.updateMany({
      where: {
        userId: ctx.actor.id,
        readAt: null,
        ...(input.ids ? { id: { in: input.ids } } : {}),
      },
      data: { readAt: ctx.now },
    });
    return { marked: count };
  },
});
