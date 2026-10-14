import { defineUseCase } from '../../../shared/use-case';
import { requireLeadInScope } from '../../leads';
import { leadStageHistoryInput } from '../contracts/schemas';
import { stageDurationSeconds } from '../domain/transitions';

/** Histórico de etapas do lead com a duração de cada passagem (MVP M08). */
export const listLeadStageHistory = defineUseCase({
  name: 'pipeline.stageHistory',
  access: 'lead.read',
  input: leadStageHistoryInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.leadStageHistory.findMany({
      where: { leadId: input.leadId },
      orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        enteredAt: true,
        leftAt: true,
        durationSeconds: true,
        automationSource: true,
        note: true,
        fromStage: { select: { key: true, name: true } },
        toStage: { select: { key: true, name: true, category: true, color: true } },
        changedBy: { select: { name: true } },
        lossReason: { select: { key: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      from: row.fromStage,
      to: row.toStage,
      enteredAt: row.enteredAt,
      leftAt: row.leftAt,
      /** Passagem aberta: tempo até agora. */
      durationSeconds: row.durationSeconds ?? stageDurationSeconds(row.enteredAt, ctx.now),
      current: row.leftAt === null,
      changedByName: row.changedBy?.name ?? null,
      automationSource: row.automationSource,
      lossReason: row.lossReason,
      note: row.note,
    }));
  },
});
