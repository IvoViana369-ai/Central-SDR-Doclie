import type { StageChangeSource } from '@docline/db';
import { ConflictError } from '../../../shared/errors';
import { toJson, type UseCaseContext } from '../../../shared/use-case';
import { LEAD_EVENTS } from '../../leads';
import { stageDurationSeconds, type StageRef } from '../domain/transitions';

export const stageRefSelect = {
  id: true,
  key: true,
  name: true,
  category: true,
  requiresLossReason: true,
  active: true,
  pipelineId: true,
} as const;

export type StageRow = StageRef & { pipelineId: string };

export interface StageChange {
  lead: { id: string; version: number; stageId: string | null };
  from: StageRow | null;
  to: StageRow;
  /** Nulo quando foi o sistema (ver `source`). */
  changedById: string | null;
  source: StageChangeSource | null;
  lossReason?: { id: string; key: string; name: string } | null;
  note?: string | null;
}

/**
 * Aplica a mudança de etapa (já autorizada): fecha a passagem aberta com a
 * duração, abre a nova, atualiza o lead (com lock otimista) e o desfecho, e
 * grava o evento `stage.changed` na timeline. Devolve a nova versão do lead.
 */
export async function applyStageChange(ctx: UseCaseContext, change: StageChange) {
  const { lead, from, to } = change;
  const open = await ctx.tx.leadStageHistory.findFirst({
    where: { leadId: lead.id, leftAt: null },
    select: { id: true, enteredAt: true },
  });
  const durationSeconds = open ? stageDurationSeconds(open.enteredAt, ctx.now) : null;
  if (open) {
    await ctx.tx.leadStageHistory.update({
      where: { id: open.id },
      data: { leftAt: ctx.now, durationSeconds },
    });
  }
  await ctx.tx.leadStageHistory.create({
    data: {
      leadId: lead.id,
      fromStageId: from?.id ?? null,
      toStageId: to.id,
      changedById: change.changedById,
      automationSource: change.source,
      lossReasonId: change.lossReason?.id ?? null,
      note: change.note ?? null,
      enteredAt: ctx.now,
    },
  });

  // O desfecho acompanha a etapa atual: reabrir um lead limpa a perda ou a conversão.
  const updated = await ctx.tx.lead.updateMany({
    where: { id: lead.id, version: lead.version },
    data: {
      pipelineId: to.pipelineId,
      stageId: to.id,
      stageEnteredAt: ctx.now,
      lostAt: to.category === 'LOST' ? ctx.now : null,
      lossReasonId: to.category === 'LOST' ? (change.lossReason?.id ?? null) : null,
      convertedAt: to.category === 'WON' ? ctx.now : null,
      version: { increment: 1 },
      lastActivityAt: ctx.now,
    },
  });
  if (updated.count === 0) {
    throw new ConflictError('O lead foi alterado por outra pessoa. Recarregue e tente de novo.');
  }

  const actorType = change.changedById ? 'USER' : 'AUTOMATION';
  await ctx.tx.leadEvent.create({
    data: {
      leadId: lead.id,
      type: LEAD_EVENTS.stageChanged,
      occurredAt: ctx.now,
      actorType,
      actorId: change.changedById,
      payload: toJson({
        from: from ? { key: from.key, name: from.name } : null,
        to: { key: to.key, name: to.name, category: to.category },
        durationSeconds,
        ...(change.lossReason ? { lossReason: change.lossReason.key } : {}),
        ...(change.source ? { source: change.source } : {}),
      }),
    },
  });
  return { version: lead.version + 1, durationSeconds };
}
