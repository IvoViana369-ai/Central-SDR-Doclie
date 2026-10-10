import type { ScoreBand } from '@docline/db';
import { NotFoundError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import {
  computeScore,
  loadActiveModel,
  loadScoreFacts,
  SCORE_BAND_LABELS,
  scoreTriggerLabel,
} from '../../scoring';
import { leadIdInput } from '../contracts/schemas';
import { requireLeadInScope } from '../infra/scope';

/**
 * Score do lead com a explicação por critério (F4-06), calculada agora com o
 * modelo ativo, e o histórico de mudanças.
 */
export const getLeadScore = defineUseCase({
  name: 'leads.score',
  access: 'lead.read',
  input: leadIdInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, {
      id: true,
      score: true,
      scoreBand: true,
      scoreComputedAt: true,
    });
    const model = await loadActiveModel(ctx.tx);
    if (!model) throw new NotFoundError('Nenhum modelo de score ativo.');
    const [state] = await loadScoreFacts(ctx.tx, [lead.id]);
    const result = computeScore(model, state!.facts, ctx.now);
    const history = await ctx.tx.leadScoreHistory.findMany({
      where: { leadId: lead.id },
      orderBy: [{ computedAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: {
        id: true,
        score: true,
        band: true,
        previousScore: true,
        previousBand: true,
        trigger: true,
        computedAt: true,
        model: { select: { version: true } },
      },
    });
    return {
      score: lead.score,
      band: lead.scoreBand,
      bandLabel: lead.scoreBand ? SCORE_BAND_LABELS[lead.scoreBand] : null,
      computedAt: lead.scoreComputedAt,
      model: { id: model.id, version: model.version, name: model.name },
      /** O cálculo de agora difere do guardado (ex.: recálculo ainda na fila do worker). */
      pending: result.score !== lead.score || result.band !== lead.scoreBand,
      current: {
        score: result.score,
        band: result.band,
        bandLabel: SCORE_BAND_LABELS[result.band],
        raw: result.raw,
      },
      breakdown: result.breakdown,
      history: history.map(({ model: m, ...h }) => ({
        ...h,
        bandLabel: SCORE_BAND_LABELS[h.band as ScoreBand],
        triggerLabel: scoreTriggerLabel(h.trigger),
        modelVersion: m.version,
      })),
    };
  },
});
