import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { defineUseCase } from '../../../shared/use-case';
import { formatLeadCode, leadScopeWhere } from '../../leads';
import { describeMessage, messageSelect } from './outbound';

const VIEWS = ['pending', 'sent', 'replies', 'unclassified'] as const;
const PAGE = 50;

/**
 * Tela Mensagens (docs/ROADMAP.md, Fase 5): envios aguardando confirmação (os
 * do próprio usuário), enviadas, respostas e respostas sem classificação, no
 * escopo de leads do ator.
 */
export const listMessages = defineUseCase({
  name: 'messaging.list',
  access: 'lead.read',
  input: z.object({ view: z.enum(VIEWS).default('pending'), cursor: z.uuid().optional() }),
  async run(ctx, input) {
    const scope = await leadScopeWhere(ctx.tx, ctx.actor);
    const self = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const byView: Record<(typeof VIEWS)[number], Prisma.MessageWhereInput> = {
      pending: { status: 'PENDING_CONFIRMATION', createdById: self },
      sent: { direction: 'OUTBOUND', status: { in: ['SENT', 'DELIVERED', 'READ'] } },
      replies: { direction: 'INBOUND' },
      unclassified: { direction: 'INBOUND', classification: null },
    };
    const rows = await ctx.tx.message.findMany({
      where: { ...byView[input.view], lead: scope },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { ...messageSelect, lead: { select: { id: true, code: true, displayName: true } } },
    });
    const page = rows.slice(0, PAGE);
    return {
      data: page.map(({ lead, ...m }) => ({
        ...describeMessage(m),
        lead: { ...lead, codeLabel: formatLeadCode(lead.code) },
      })),
      nextCursor: rows.length > PAGE ? page.at(-1)!.id : null,
    };
  },
});
