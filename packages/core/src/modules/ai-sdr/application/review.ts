import type { z } from 'zod';
import type { Actor } from '../../../shared/actor';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
  type UseCaseContext,
} from '../../../shared/use-case';
import { auditLead, requireEditableLead, requireLeadInScope } from '../../leads';
import { prepareAssistedMessage } from '../../messaging';
import {
  approveGenerationInput,
  discardGenerationInput,
  editGenerationInput,
  generationIdInput,
  leadGenerationsInput,
  rateGenerationInput,
} from '../contracts/schemas';
import { hasBlocking } from '../domain/guardrails';
import type { OutreachKind } from '../domain/kinds';
import { editDistanceRatio } from '../domain/text-metrics';
import { outreachFlags } from './generate';
import { describeGeneration, generationSelect, withLead } from './view';

/** Rascunho de um lead no escopo; para alterar, o lead precisa estar editável. */
async function requireGeneration(ctx: UseCaseContext, generationId: string, write: boolean) {
  const generation = await ctx.tx.aiGeneration.findUnique({
    where: { id: generationId },
    select: generationSelect,
  });
  if (!generation) throw new NotFoundError('Rascunho não encontrado.');
  const draft = withLead(generation);
  if (write) await requireEditableLead(ctx, draft.leadId, { id: true });
  else await requireLeadInScope(ctx, draft.leadId, { id: true });
  return draft;
}

const REVIEWABLE = ['GENERATED', 'EDITED', 'APPROVED'];

function assertReviewable(generation: Awaited<ReturnType<typeof requireGeneration>>) {
  if (generation.kind === 'REPLY_CLASSIFICATION') {
    throw new BusinessRuleError('Sugestões de classificação não viram mensagem.');
  }
  if (!REVIEWABLE.includes(generation.status)) {
    throw new BusinessRuleError('Este rascunho não pode mais ser alterado.');
  }
  if (generation.messages.length > 0) {
    throw new BusinessRuleError(
      'Este rascunho já tem um envio. Cancele o envio para mudar o texto.',
    );
  }
}

/** O SDR edita o rascunho: guardrails de novo no texto editado. */
export const editGeneration = defineUseCase({
  name: 'ai.edit',
  access: 'ai.generate',
  input: editGenerationInput,
  async run(ctx, input) {
    const generation = await requireGeneration(ctx, input.generationId, true);
    assertReviewable(generation);
    const flags = await outreachFlags(ctx, generation, input.text);
    const updated = await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status: 'EDITED',
        textFinal: input.text,
        editDistanceRatio: editDistanceRatio(generation.textGenerated ?? '', input.text),
        guardrailFlags: toJson(flags),
        approvedById: null,
        approvedAt: null,
      },
      select: generationSelect,
    });
    await auditLead(ctx, generation.leadId, 'ai.edit', {
      subjectId: generation.id,
      metadata: { flags: flags.map((f) => f.code) },
    });
    return describeGeneration(updated);
  },
});

/** Aprovação (transação própria): bloqueio dos guardrails impede aprovar sem corrigir. */
const approveGenerationTx = defineUseCase({
  name: 'ai.approve',
  access: 'ai.generate',
  input: approveGenerationInput,
  async run(ctx, input) {
    const generation = await requireGeneration(ctx, input.generationId, true);
    assertReviewable(generation);
    const flags = await outreachFlags(ctx, generation, input.text);
    if (hasBlocking(flags)) {
      throw new BusinessRuleError(
        `Corrija antes de aprovar: ${flags
          .filter((f) => f.severity === 'BLOCKING')
          .map((f) => f.message)
          .join(' ')}`,
      );
    }
    const ratio = editDistanceRatio(generation.textGenerated ?? '', input.text);
    const updated = await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status: 'APPROVED',
        textFinal: input.text,
        editDistanceRatio: ratio,
        guardrailFlags: toJson(flags),
        approvedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        approvedAt: ctx.now,
      },
      select: generationSelect,
    });
    await auditLead(ctx, generation.leadId, 'ai.approve', {
      subjectId: generation.id,
      metadata: { kind: generation.kind, editRatio: ratio, flags: flags.map((f) => f.code) },
    });
    return describeGeneration(updated);
  },
});

/**
 * Aprovar e preparar o envio (M12 + M13): o texto aprovado é o que vai para o
 * contato assistido (`messages.body` = `text_final`), com gate de novo. Se o
 * envio não puder ser preparado agora (ex.: fora do horário), o rascunho fica
 * aprovado e pode ser enviado depois.
 */
export async function approveGeneration(
  deps: CoreDeps,
  actor: Actor,
  input: z.input<typeof approveGenerationInput>,
  meta: RequestMeta = {},
) {
  const generation = withLead(await approveGenerationTx(deps, actor, input, meta));
  const prepared = await prepareAssistedMessage(
    deps,
    actor,
    {
      leadId: generation.leadId,
      channel: generation.channel as 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL',
      contactPointId: input.contactPointId ?? null,
      body: generation.text!,
      messageType: generation.kind as OutreachKind,
      taskId: input.taskId ?? null,
      aiGenerationId: generation.id,
    },
    meta,
  );
  return {
    generation: {
      ...generation,
      activeMessage: { id: prepared.message.id, status: prepared.message.status },
    },
    message: prepared.message,
    link: prepared.link,
  };
}

export const discardGeneration = defineUseCase({
  name: 'ai.discard',
  access: 'ai.generate',
  input: discardGenerationInput,
  async run(ctx, input) {
    const generation = await requireGeneration(ctx, input.generationId, true);
    assertReviewable(generation);
    const updated = await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: { status: 'DISCARDED', discardReason: input.reason },
      select: generationSelect,
    });
    await auditLead(ctx, generation.leadId, 'ai.discard', {
      subjectId: generation.id,
      metadata: { kind: generation.kind },
    });
    return describeGeneration(updated);
  },
});

/** Nota de 1 a 5 e comentário opcional: alimentam a avaliação de qualidade (§14). */
export const rateGeneration = defineUseCase({
  name: 'ai.rate',
  access: 'ai.generate',
  input: rateGenerationInput,
  async run(ctx, input) {
    const generation = await requireGeneration(ctx, input.generationId, false);
    if (generation.status === 'BLOCKED' || generation.status === 'FAILED') {
      throw new BusinessRuleError('Não há rascunho para avaliar.');
    }
    const updated = await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: { rating: input.rating, feedback: input.feedback },
      select: generationSelect,
    });
    await auditLead(ctx, generation.leadId, 'ai.rate', {
      subjectId: generation.id,
      metadata: { rating: input.rating },
    });
    return describeGeneration(updated);
  },
});

export const getGeneration = defineUseCase({
  name: 'ai.get',
  access: 'lead.read',
  input: generationIdInput,
  async run(ctx, input) {
    return describeGeneration(await requireGeneration(ctx, input.generationId, false));
  },
});

/** Rascunhos recentes do lead (ficha). */
export const listLeadGenerations = defineUseCase({
  name: 'ai.forLead',
  access: 'lead.read',
  input: leadGenerationsInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const rows = await ctx.tx.aiGeneration.findMany({
      where: { leadId: input.leadId, kind: { not: 'REPLY_CLASSIFICATION' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: generationSelect,
    });
    return rows.map(describeGeneration);
  },
});
