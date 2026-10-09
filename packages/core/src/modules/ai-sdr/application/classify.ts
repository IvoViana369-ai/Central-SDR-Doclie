import { z } from 'zod';
import type { AiStructuredResult } from '../../../ports/ai';
import type { Actor } from '../../../shared/actor';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, toJson, type CoreDeps, type RequestMeta } from '../../../shared/use-case';
import { auditLead, requireLeadInScope } from '../../leads';
import { suggestClassificationInput } from '../contracts/schemas';
import { redactContactData } from '../domain/context';
import { estimateCostUsd } from '../domain/cost';
import { checkReplyClassification, clampConfidence } from '../domain/guardrails';
import { replyClassificationSchema, type ReplyClassificationOutput } from '../domain/schemas';
import {
  CLASSIFICATION_MAX_OUTPUT_TOKENS,
  REPLY_CLASSIFICATION_PROMPT,
  REPLY_CLASSIFICATION_SYSTEM,
  replyClassificationUserMessage,
} from '../prompts';
import { alertBudget, assertAiAllowance } from '../infra/sources';
import { callProvider, IN_PROGRESS, usageColumns } from './generate';

const REPLY_MAX = 2000;
const CONTEXT_MAX = 280;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const beginClassification = defineUseCase({
  name: 'ai.classify.begin',
  access: 'ai.generate',
  input: suggestClassificationInput,
  async run(ctx, input) {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: { id: true, leadId: true, direction: true, body: true, createdAt: true },
    });
    if (!message) throw new NotFoundError('Mensagem não encontrada.');
    await requireLeadInScope(ctx, message.leadId, { id: true });
    if (message.direction !== 'INBOUND' || !message.body?.trim()) {
      throw new BusinessRuleError('Só respostas recebidas com texto podem ser classificadas.');
    }
    const requestedById = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    await assertAiAllowance(ctx, requestedById);
    const lastOutbound = await ctx.tx.message.findFirst({
      where: {
        leadId: message.leadId,
        direction: 'OUTBOUND',
        status: { not: 'CANCELED' },
        createdAt: { lt: message.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { messageType: true, body: true },
    });
    // Minimização (§5): sem telefones, e-mails e links; textos truncados.
    const snapshot = {
      reply: truncate(redactContactData(message.body.trim()), REPLY_MAX),
      lastOutboundType: lastOutbound?.messageType ?? null,
      lastOutboundText: lastOutbound?.body
        ? truncate(redactContactData(lastOutbound.body), CONTEXT_MAX)
        : null,
    };
    const pending = await ctx.tx.aiGeneration.create({
      data: {
        leadId: message.leadId,
        requestedById,
        kind: 'REPLY_CLASSIFICATION',
        sourceMessageId: message.id,
        promptId: REPLY_CLASSIFICATION_PROMPT.id,
        promptVersion: REPLY_CLASSIFICATION_PROMPT.version,
        provider: ctx.deps.ai.name,
        model: ctx.deps.ai.models.classification,
        params: toJson({
          effort: ctx.deps.aiLimits.effortClassification,
          maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
        }),
        inputSnapshot: toJson(snapshot),
        status: 'FAILED',
        errorCode: IN_PROGRESS,
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    return { generationId: pending.id, input: replyClassificationUserMessage(snapshot) };
  },
});

const finishClassification = defineUseCase({
  name: 'ai.classify.finish',
  access: 'ai.generate',
  input: z.object({
    generationId: z.uuid(),
    result: z.custom<AiStructuredResult<ReplyClassificationOutput>>(),
  }),
  async run(ctx, input) {
    const generation = await ctx.tx.aiGeneration.findUniqueOrThrow({
      where: { id: input.generationId },
      select: { id: true, leadId: true, status: true, errorCode: true, sourceMessageId: true },
    });
    if (generation.status !== 'FAILED' || generation.errorCode !== IN_PROGRESS) {
      throw new ConflictError('Esta classificação já foi concluída.');
    }
    const { result } = input;
    const data = { ...result.data, confidence: clampConfidence(result.data.confidence) };
    const flags = checkReplyClassification(data);
    const cost = estimateCostUsd(result.model, result.usage);
    await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status: 'GENERATED',
        errorCode: null,
        model: result.model,
        output: toJson(data),
        guardrailFlags: toJson(flags),
        stopReason: result.stopReason,
        ...usageColumns(result.usage, cost, result.latencyMs),
      },
    });
    await alertBudget(ctx, cost ?? 0);
    await auditLead(ctx, generation.leadId, 'ai.classify_suggest', {
      subjectId: generation.id,
      metadata: {
        messageId: generation.sourceMessageId,
        label: data.label,
        confidence: data.confidence,
        model: result.model,
      },
    });
    return { generationId: generation.id, messageId: generation.sourceMessageId, ...data, flags };
  },
});

/**
 * Sugestão de classificação de uma resposta recebida (F6-06; docs/AI-SDR.md
 * §12). A regra determinística de opt-out já rodou no registro; a sugestão
 * não muda nada sozinha: uma pessoa confirma pela classificação manual.
 */
export async function suggestReplyClassification(
  deps: CoreDeps,
  actor: Actor,
  input: z.input<typeof suggestClassificationInput>,
  meta: RequestMeta = {},
) {
  const begun = await beginClassification(deps, actor, input, meta);
  const result = await callProvider(deps, actor, meta, begun.generationId, () =>
    deps.ai.generateStructured({
      task: 'reply_classification',
      system: REPLY_CLASSIFICATION_SYSTEM,
      input: begun.input,
      schema: replyClassificationSchema,
      effort: deps.aiLimits.effortClassification,
      maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
    }),
  );
  return finishClassification(deps, actor, { generationId: begun.generationId, result }, meta);
}
