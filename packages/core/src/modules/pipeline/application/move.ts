import { BusinessRuleError, ConflictError, ValidationError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import {
  applyLeadOptOut,
  auditLead,
  formatLeadCode,
  requireLeadForOptOut,
  requireLeadInScope,
} from '../../leads';
import { moveLeadStageInput } from '../contracts/schemas';
import { checkTransition } from '../domain/transitions';
import { applyStageChange, stageRefSelect } from '../infra/stage-change';

/** Motivo de perda que é, ele mesmo, um pedido de opt-out (LGPD: vale na hora). */
export const OPT_OUT_LOSS_REASON = 'ASKED_NOT_TO_BE_CONTACTED';

/**
 * Move o lead de etapa no pipeline (docs/SDR-FLOW.md §3.2; MVP M08): regras
 * de transição, motivo obrigatório na perda, histórico com duração, lock
 * otimista, timeline e auditoria. Perder com o motivo "Pediu para não ser
 * contatado" também inclui o lead na Lista Não Contatar.
 */
export const moveLeadStage = defineUseCase({
  name: 'pipeline.moveLead',
  access: 'lead.update',
  input: moveLeadStageInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, {
      id: true,
      code: true,
      version: true,
      status: true,
      pipelineId: true,
      stageId: true,
    });
    if (lead.status !== 'ACTIVE') {
      throw new ConflictError(
        lead.status === 'ARCHIVED'
          ? 'Reative o lead antes de mudar a etapa.'
          : 'Este lead não pode mais mudar de etapa.',
      );
    }
    const [from, to] = await Promise.all([
      lead.stageId
        ? ctx.tx.pipelineStage.findUnique({ where: { id: lead.stageId }, select: stageRefSelect })
        : null,
      ctx.tx.pipelineStage.findUnique({ where: { id: input.stageId }, select: stageRefSelect }),
    ]);
    if (!to || (lead.pipelineId && to.pipelineId !== lead.pipelineId)) {
      throw new ValidationError([
        { path: 'stageId', message: 'Etapa não encontrada no pipeline do lead.' },
      ]);
    }
    if (lead.version !== input.version) {
      throw new ConflictError(
        `O lead foi alterado por outra pessoa${from ? ` e está em "${from.name}"` : ''}. Recarregue o quadro.`,
      );
    }

    const lossReason =
      to.category === 'LOST' && input.lossReasonId
        ? await ctx.tx.lossReason.findFirst({
            where: { id: input.lossReasonId, active: true },
            select: { id: true, key: true, name: true, appliesToStageKeys: true },
          })
        : null;
    if (input.lossReasonId && to.category === 'LOST') {
      if (
        !lossReason ||
        (lossReason.appliesToStageKeys.length > 0 &&
          !lossReason.appliesToStageKeys.includes(to.key))
      ) {
        throw new ValidationError([
          { path: 'lossReasonId', message: 'Motivo de perda inválido para esta etapa.' },
        ]);
      }
    }

    const privileged =
      ctx.actor.kind === 'system' ||
      (ctx.actor.kind === 'user' && (ctx.actor.role === 'ADMIN' || ctx.actor.role === 'MANAGER'));
    const check = checkTransition({ from, to, privileged, lossReasonGiven: Boolean(lossReason) });
    if (!check.ok) {
      if (check.error === 'LOSS_REASON_REQUIRED') {
        throw new ValidationError([{ path: 'lossReasonId', message: check.message }]);
      }
      throw new BusinessRuleError(check.message);
    }

    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const result = await applyStageChange(ctx, {
      lead,
      from,
      to,
      changedById: actorId,
      source: actorId ? null : 'RULE',
      lossReason,
      note: input.note,
    });
    await auditLead(ctx, lead.id, 'lead.stage_change', {
      changes: { stage: [from?.name ?? null, to.name] },
      metadata: {
        code: formatLeadCode(lead.code),
        from: from?.key ?? null,
        to: to.key,
        durationSeconds: result.durationSeconds,
        ...(lossReason ? { lossReason: lossReason.key } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(check.override ? { override: true } : {}),
      },
    });

    let optedOut = false;
    if (lossReason?.key === OPT_OUT_LOSS_REASON) {
      await applyLeadOptOut(ctx, await requireLeadForOptOut(ctx, lead.id), {
        scope: 'ALL_CHANNELS',
        reason: 'OPT_OUT',
        notes: 'Registrado ao mover para uma etapa de perda com este motivo.',
      });
      optedOut = true;
    }

    return {
      leadId: lead.id,
      stageId: to.id,
      stageKey: to.key,
      stageName: to.name,
      version: result.version,
      optedOut,
    };
  },
});
