import type { AssignmentStrategy } from '@docline/db';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { z } from 'zod';
import { assignLeadInput, leadIdInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { auditLead, recordLeadEvent } from '../infra/events';
import { isPoolLead, requireEditableLead } from '../infra/scope';
import { resolveOwner } from './create-lead';

/** Troca o responsável e registra o histórico (lead_assignments), o evento e a auditoria. */
export async function changeOwner(
  ctx: UseCaseContext,
  lead: { id: string; ownerId: string | null },
  ownerId: string | null,
  strategy: AssignmentStrategy,
  reason: string | null,
): Promise<boolean> {
  if (lead.ownerId === ownerId) return false;
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  await ctx.tx.lead.update({
    where: { id: lead.id },
    data: {
      ownerId,
      previousOwnerId: lead.ownerId,
      assignedAt: ownerId ? ctx.now : null,
      lastActivityAt: ctx.now,
    },
  });
  await ctx.tx.leadAssignment.create({
    data: {
      leadId: lead.id,
      fromUserId: lead.ownerId,
      toUserId: ownerId,
      strategy,
      assignedById: actorId,
      reason,
      assignedAt: ctx.now,
    },
  });
  await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.ownerAssigned, {
    payload: { fromUserId: lead.ownerId, toUserId: ownerId, strategy },
  });
  await auditLead(ctx, lead.id, 'lead.assign', {
    changes: { ownerId: [lead.ownerId, ownerId] },
    metadata: { strategy, ...(reason ? { reason } : {}) },
  });
  return true;
}

/** Atribuir ou redistribuir (ADMIN/GESTOR). `ownerId` nulo devolve o lead ao pool. */
export const assignLead = defineUseCase({
  name: 'leads.assign',
  access: 'lead.assign',
  input: assignLeadInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true, ownerId: true });
    const ownerId = await resolveOwner(ctx, input.ownerId, 'ownerId');
    const changed = await changeOwner(ctx, lead, ownerId, 'MANUAL', input.reason ?? null);
    return { changed, ownerId };
  },
});

/** O SDR "puxa do pool": assume um lead ativo e sem responsável do seu território. */
export const claimLead = defineUseCase({
  name: 'leads.claim',
  access: 'lead.update',
  input: leadIdInput,
  async run(ctx, input) {
    if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
    const lead = await requireEditableLead(ctx, input.leadId, { id: true, ownerId: true });
    if (lead.ownerId === ctx.actor.id) return { changed: false, ownerId: lead.ownerId };
    if (!isPoolLead(lead)) {
      throw new ConflictError('Este lead já tem responsável ou não está ativo.');
    }
    // Garante que dois SDRs não puxem o mesmo lead ao mesmo tempo.
    const taken = await ctx.tx.lead.updateMany({
      where: { id: lead.id, ownerId: null, status: 'ACTIVE' },
      data: { ownerId: ctx.actor.id },
    });
    if (taken.count === 0) throw new ConflictError('Outra pessoa acabou de assumir este lead.');
    await changeOwner(ctx, { id: lead.id, ownerId: null }, ctx.actor.id, 'CLAIM', null);
    return { changed: true, ownerId: ctx.actor.id };
  },
});

/**
 * Puxar do pool (F5-13; docs/SDR-FLOW.md §10): o SDR pega os próximos leads
 * sem responsável do seu território, do maior score para o menor. Cada lead
 * só é atribuído se ainda estiver livre (trava contra dois SDRs pegarem o
 * mesmo); leads na Lista Não Contatar, ganhos ou perdidos ficam de fora.
 */
export const pullLeadsFromPool = defineUseCase({
  name: 'leads.pullFromPool',
  access: 'lead.update',
  input: z.object({ count: z.number().int().min(1).max(20).default(5) }),
  async run(ctx, input) {
    if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
    const territories = await ctx.tx.userTerritory.findMany({
      where: { userId: ctx.actor.id },
      select: { stateUf: true, municipalityCode: true },
    });
    if (territories.length === 0) {
      throw new BusinessRuleError('Você não tem território configurado: peça ao gestor.');
    }
    const candidates = await ctx.tx.lead.findMany({
      where: {
        ownerId: null,
        status: 'ACTIVE',
        contactStatus: { notIn: ['OPTED_OUT', 'BLOCKED'] },
        OR: territories.map((t) =>
          t.municipalityCode === null
            ? { stateUf: t.stateUf }
            : { municipalityCode: t.municipalityCode },
        ),
        stage: { category: { in: ['OPEN', 'PARKED'] } },
      },
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
      take: input.count * 3,
      select: { id: true },
    });
    const claimed: string[] = [];
    for (const { id } of candidates) {
      if (claimed.length >= input.count) break;
      const taken = await ctx.tx.lead.updateMany({
        where: { id, ownerId: null, status: 'ACTIVE' },
        data: { ownerId: ctx.actor.id },
      });
      if (taken.count === 0) continue; // outra pessoa pegou antes
      await changeOwner(ctx, { id, ownerId: null }, ctx.actor.id, 'CLAIM', 'Puxado do pool.');
      claimed.push(id);
    }
    return { claimed };
  },
});
