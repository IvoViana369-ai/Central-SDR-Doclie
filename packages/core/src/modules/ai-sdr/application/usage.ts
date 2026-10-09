import { defineUseCase } from '../../../shared/use-case';
import { aiUsageInput } from '../contracts/schemas';
import { AI_KIND_LABELS, type AiGenerationKindKey } from '../domain/kinds';
import { monthRange } from '../infra/sources';

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

/**
 * Painel de custo e qualidade da IA (docs/AI-SDR.md §11 e §15): gasto do mês
 * contra o orçamento, por pessoa, tipo e versão de prompt, e as métricas de
 * qualidade (aprovado sem edição, proporção de edição, descartes e motivos).
 */
export const getAiUsage = defineUseCase({
  name: 'ai.usage',
  access: 'report.read',
  input: aiUsageInput,
  async run(ctx, input) {
    const { start, end, label } = monthRange(ctx.now, input.month);
    const where = { createdAt: { gte: start, lt: end } };
    const drafts = { ...where, kind: { not: 'REPLY_CLASSIFICATION' as const } };
    const [totals, byKindStatus, byUser, byPrompt, approved, approvedUnedited, discards] =
      await Promise.all([
        ctx.tx.aiGeneration.aggregate({
          where,
          _count: { _all: true },
          _sum: {
            costEstimateUsd: true,
            inputTokens: true,
            outputTokens: true,
            cachedInputTokens: true,
          },
        }),
        ctx.tx.aiGeneration.groupBy({
          by: ['kind', 'status'],
          where,
          _count: { _all: true },
          _sum: { costEstimateUsd: true },
        }),
        ctx.tx.aiGeneration.groupBy({
          by: ['requestedById'],
          where,
          _count: { _all: true },
          _sum: { costEstimateUsd: true },
        }),
        ctx.tx.aiGeneration.groupBy({
          by: ['promptId', 'promptVersion'],
          where,
          _count: { _all: true },
          _sum: { costEstimateUsd: true },
          _avg: { editDistanceRatio: true, rating: true },
        }),
        ctx.tx.aiGeneration.aggregate({
          where: { ...drafts, status: { in: ['APPROVED', 'SENT'] } },
          _count: { _all: true },
          _avg: { editDistanceRatio: true },
        }),
        ctx.tx.aiGeneration.count({
          where: { ...drafts, status: { in: ['APPROVED', 'SENT'] }, editDistanceRatio: 0 },
        }),
        ctx.tx.aiGeneration.groupBy({
          by: ['discardReason'],
          where: { ...drafts, status: 'DISCARDED' },
          _count: { _all: true },
        }),
      ]);

    const users = await ctx.tx.user.findMany({
      where: { id: { in: byUser.flatMap((u) => (u.requestedById ? [u.requestedById] : [])) } },
      select: { id: true, name: true },
    });
    const kinds = new Map<
      string,
      { count: number; costUsd: number; byStatus: Record<string, number> }
    >();
    for (const row of byKindStatus) {
      const entry = kinds.get(row.kind) ?? { count: 0, costUsd: 0, byStatus: {} };
      entry.count += row._count._all;
      entry.costUsd += num(row._sum.costEstimateUsd);
      entry.byStatus[row.status] = row._count._all;
      kinds.set(row.kind, entry);
    }
    const draftsCreated = byKindStatus
      .filter((r) => r.kind !== 'REPLY_CLASSIFICATION' && !['BLOCKED', 'FAILED'].includes(r.status))
      .reduce((sum, r) => sum + r._count._all, 0);
    const discarded = discards.reduce((sum, d) => sum + d._count._all, 0);

    return {
      month: label,
      provider: ctx.deps.ai.name,
      models: ctx.deps.ai.models,
      budgetUsd: ctx.deps.aiLimits.monthlyBudgetUsd,
      spentUsd: num(totals._sum.costEstimateUsd),
      requests: totals._count._all,
      tokens: {
        input: num(totals._sum.inputTokens),
        output: num(totals._sum.outputTokens),
        cachedInput: num(totals._sum.cachedInputTokens),
      },
      quality: {
        draftsCreated,
        approved: approved._count._all,
        approvedWithoutEdit: approvedUnedited,
        avgEditRatio:
          approved._avg.editDistanceRatio === null ? null : num(approved._avg.editDistanceRatio),
        discarded,
      },
      byKind: [...kinds.entries()]
        .map(([kind, v]) => ({ kind, label: AI_KIND_LABELS[kind as AiGenerationKindKey], ...v }))
        .sort((a, b) => b.count - a.count),
      byUser: byUser
        .map((u) => ({
          userId: u.requestedById,
          name: users.find((x) => x.id === u.requestedById)?.name ?? 'Sistema',
          count: u._count._all,
          costUsd: num(u._sum.costEstimateUsd),
        }))
        .sort((a, b) => b.costUsd - a.costUsd || b.count - a.count),
      byPrompt: byPrompt.map((p) => ({
        prompt: `${p.promptId}@v${p.promptVersion}`,
        count: p._count._all,
        costUsd: num(p._sum.costEstimateUsd),
        avgEditRatio: p._avg.editDistanceRatio === null ? null : num(p._avg.editDistanceRatio),
        avgRating: p._avg.rating === null ? null : num(p._avg.rating),
      })),
      discardReasons: discards
        .map((d) => ({ reason: d.discardReason ?? '(sem motivo)', count: d._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  },
});
