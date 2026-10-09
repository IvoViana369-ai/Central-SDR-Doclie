import { z } from 'zod';
import {
  AiProviderError,
  type AiErrorCode,
  type AiStructuredResult,
  type AiTokenUsage,
} from '../../../ports/ai';
import type { Actor } from '../../../shared/actor';
import { DEFAULT_TIME_ZONE } from '../../../shared/calendar';
import {
  BusinessRuleError,
  ConflictError,
  ExternalServiceError,
  ValidationError,
} from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
  type UseCaseContext,
} from '../../../shared/use-case';
import { evaluateLeadGate } from '../../compliance';
import { auditLead, requireEditableLead } from '../../leads';
import { generateOutreachInput } from '../contracts/schemas';
import { buildOutreachContext } from '../domain/context';
import { estimateCostUsd } from '../domain/cost';
import { checkOutreachText, type GuardrailFlag } from '../domain/guardrails';
import { outreachMessageSchema, type OutreachMessage } from '../domain/schemas';
import {
  OUTREACH_MAX_OUTPUT_TOKENS,
  OUTREACH_PROMPT,
  outreachSystemPrompt,
  outreachUserMessage,
} from '../prompts';
import {
  alertBudget,
  assertAiAllowance,
  loadAiRules,
  loadKnowledge,
  loadLeadContextSource,
  recentOtherMessages,
} from '../infra/sources';
import { describeGeneration, generationSelect, type StoredContext } from './view';

const CHANNEL_LABELS = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', EMAIL: 'E-mail' } as const;
/** Marca de geração em andamento (a chamada à IA corre fora da transação). */
export const IN_PROGRESS = 'IN_PROGRESS';

const actorId = (ctx: UseCaseContext) => (ctx.actor.kind === 'user' ? ctx.actor.id : null);

/** Mensagens claras para a pessoa, por tipo de falha do provedor. */
export function aiFailure(error: unknown): Error {
  if (!(error instanceof AiProviderError)) {
    return new ExternalServiceError('Falha inesperada ao chamar a IA. Tente de novo.');
  }
  const messages: Record<AiErrorCode, string> = {
    REFUSAL: 'A IA recusou este pedido. Ajuste as instruções ou escreva a mensagem você mesmo.',
    MAX_TOKENS: 'A resposta da IA ficou grande demais. Tente de novo.',
    INVALID_OUTPUT: 'A IA não devolveu uma resposta válida. Tente de novo.',
    RATE_LIMITED: 'Muitos pedidos à IA agora. Tente em instantes.',
    UNAVAILABLE: 'A IA está indisponível no momento. Tente em instantes.',
    TIMEOUT: 'A IA demorou demais para responder. Tente de novo.',
    AUTH: 'A IA está mal configurada. Avise o administrador.',
    BAD_REQUEST: 'A IA está mal configurada. Avise o administrador.',
  };
  const message = messages[error.code];
  return ['REFUSAL', 'MAX_TOKENS', 'INVALID_OUTPUT'].includes(error.code)
    ? new BusinessRuleError(message)
    : new ExternalServiceError(message);
}

/** Guardrails do texto contra o contexto gravado da geração. */
export async function outreachFlags(
  ctx: UseCaseContext,
  generation: { leadId: string; kind: string; inputSnapshot: unknown },
  text: string,
): Promise<GuardrailFlag[]> {
  const context = generation.inputSnapshot as StoredContext;
  return checkOutreachText(text, {
    kind: context.request.kind,
    rules: await loadAiRules(ctx.tx),
    context,
    factTexts: (context.systemFacts ?? []).map((f) => f.content),
    recentOtherMessages: await recentOtherMessages(ctx.tx, generation.leadId, ctx.now),
  });
}

/** Passo 1 (transação): gate, cota, orçamento, contexto mínimo e o registro do pedido. */
const beginOutreach = defineUseCase({
  name: 'ai.generate.begin',
  access: 'ai.generate',
  input: generateOutreachInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const requestedById = actorId(ctx);
    const [rules, knowledge, approach, requester] = await Promise.all([
      loadAiRules(ctx.tx),
      loadKnowledge(ctx.tx),
      input.approachId
        ? ctx.tx.approach.findFirst({
            where: { id: input.approachId, active: true },
            select: { id: true, key: true, name: true, guidance: true },
          })
        : Promise.resolve(null),
      requestedById
        ? ctx.tx.user.findUnique({ where: { id: requestedById }, select: { name: true } })
        : Promise.resolve(null),
    ]);
    if (input.approachId && !approach) {
      throw new ValidationError([
        { path: 'approachId', message: 'Abordagem não encontrada ou inativa.' },
      ]);
    }
    if (input.replacesGenerationId) {
      await ctx.tx.aiGeneration.updateMany({
        where: {
          id: input.replacesGenerationId,
          leadId: lead.id,
          status: { in: ['GENERATED', 'EDITED'] },
        },
        data: { status: 'DISCARDED', discardReason: 'Gerada de novo.' },
      });
    }

    const gate = await evaluateLeadGate(ctx.tx, lead.id, {
      mode: 'ASSISTED',
      actor: ctx.actor,
      now: ctx.now,
    });
    const channel = gate.channels.find((c) => c.channel === input.channel)!;
    const context = buildOutreachContext(await loadLeadContextSource(ctx.tx, lead.id), {
      kind: input.kind,
      channelLabel: CHANNEL_LABELS[input.channel],
      sdrName: requester?.name ?? 'Equipe Docline',
      approach: approach
        ? { key: approach.key, name: approach.name, guidance: approach.guidance }
        : null,
      sdrInstructions: input.instructions,
      maxChars: rules.maxChars[input.kind],
      optOutLine: rules.optOutRequiredKinds.includes(input.kind) ? rules.optOutLine : null,
      facts: knowledge.map((k) => ({ key: k.key, version: k.version })),
    });
    // Só o horário impede o contato: o rascunho pode ser preparado agora.
    if (!channel.allowed && channel.availableAt) {
      const when = channel.availableAt.toLocaleString('pt-BR', {
        timeZone: DEFAULT_TIME_ZONE,
        dateStyle: 'short',
        timeStyle: 'short',
      });
      context.warnings.push(`Contato por ${CHANNEL_LABELS[input.channel]} liberado só em ${when}.`);
    }
    const snapshot: StoredContext = {
      ...context,
      systemFacts: knowledge.map((k) => ({ key: k.key, version: k.version, content: k.content })),
    };
    const base = {
      leadId: lead.id,
      requestedById,
      kind: input.kind,
      channel: input.channel,
      approachId: approach?.id ?? null,
      promptId: OUTREACH_PROMPT.id,
      promptVersion: OUTREACH_PROMPT.version,
      provider: ctx.deps.ai.name,
      model: ctx.deps.ai.models.generation,
      params: toJson({
        effort: ctx.deps.aiLimits.effortGeneration,
        maxOutputTokens: OUTREACH_MAX_OUTPUT_TOKENS,
      }),
      inputSnapshot: toJson(snapshot),
      createdAt: ctx.now,
    };

    // Lista Não Contatar, sem base legal ou sem contato no canal: não gera (§9.1).
    if (!channel.allowed && !channel.availableAt) {
      const blocked = await ctx.tx.aiGeneration.create({
        data: {
          ...base,
          status: 'BLOCKED',
          errorCode: 'GATE',
          guardrailFlags: toJson(
            channel.reasons.map((r) => ({ code: 'GATE', severity: 'BLOCKING', message: r })),
          ),
        },
        select: generationSelect,
      });
      await auditLead(ctx, lead.id, 'ai.generate', {
        subjectId: blocked.id,
        metadata: { kind: input.kind, status: 'BLOCKED' },
      });
      return { generation: describeGeneration(blocked), call: null };
    }

    await assertAiAllowance(ctx, requestedById);
    const pending = await ctx.tx.aiGeneration.create({
      data: { ...base, status: 'FAILED', errorCode: IN_PROGRESS },
      select: { id: true },
    });
    return {
      generation: null,
      call: {
        generationId: pending.id,
        system: outreachSystemPrompt(knowledge),
        input: outreachUserMessage(context),
      },
    };
  },
});

const finishInput = z.object({
  generationId: z.uuid(),
  result: z.custom<AiStructuredResult<OutreachMessage>>(),
});

/** Passo 3 (transação): guardrails, custo e o rascunho pronto para a pessoa revisar. */
const finishOutreach = defineUseCase({
  name: 'ai.generate.finish',
  access: 'ai.generate',
  input: finishInput,
  async run(ctx, input) {
    const generation = await ctx.tx.aiGeneration.findUniqueOrThrow({
      where: { id: input.generationId },
      select: {
        id: true,
        leadId: true,
        kind: true,
        status: true,
        errorCode: true,
        inputSnapshot: true,
        params: true,
      },
    });
    if (generation.status !== 'FAILED' || generation.errorCode !== IN_PROGRESS) {
      throw new ConflictError('Esta geração já foi concluída.');
    }
    const { result } = input;
    const flags = await outreachFlags(ctx, generation, result.data.message);
    const cost = estimateCostUsd(result.model, result.usage);
    const updated = await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status: 'GENERATED',
        errorCode: null,
        model: result.model,
        params: toJson({ ...(generation.params as object), fallbackUsed: result.fallbackUsed }),
        output: toJson(result.data),
        textGenerated: result.data.message,
        guardrailFlags: toJson(flags),
        ...usageColumns(result.usage, cost, result.latencyMs),
        stopReason: result.stopReason,
      },
      select: generationSelect,
    });
    await alertBudget(ctx, cost ?? 0);
    await auditLead(ctx, generation.leadId, 'ai.generate', {
      subjectId: generation.id,
      metadata: {
        kind: generation.kind,
        status: 'GENERATED',
        model: result.model,
        flags: flags.map((f) => f.code),
        ...(result.fallbackUsed ? { fallbackUsed: true } : {}),
      },
    });
    return describeGeneration(updated);
  },
});

export function usageColumns(
  usage: AiTokenUsage | undefined,
  cost: number | null,
  latencyMs?: number,
) {
  return {
    inputTokens: usage ? usage.inputTokens + usage.cacheWriteTokens : null,
    outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.cacheReadTokens ?? null,
    costEstimateUsd: cost,
    latencyMs: latencyMs ?? null,
  };
}

const failInput = z.object({
  generationId: z.uuid(),
  code: z.string(),
  model: z.string().nullish(),
  usage: z.custom<AiTokenUsage>().optional(),
  latencyMs: z.number().optional(),
});

/** A chamada falhou: fica registrada (com o custo, se houve) e conta na cota. */
export const failGeneration = defineUseCase({
  name: 'ai.generate.fail',
  access: 'ai.generate',
  input: failInput,
  async run(ctx, input) {
    const generation = await ctx.tx.aiGeneration.findUniqueOrThrow({
      where: { id: input.generationId },
      select: { id: true, leadId: true, kind: true, model: true },
    });
    const model = input.model ?? generation.model;
    const cost = input.usage ? estimateCostUsd(model, input.usage) : null;
    await ctx.tx.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status: 'FAILED',
        errorCode: input.code,
        model,
        ...usageColumns(input.usage, cost, input.latencyMs),
      },
    });
    await alertBudget(ctx, cost ?? 0);
    await auditLead(ctx, generation.leadId, 'ai.generate', {
      subjectId: generation.id,
      metadata: { kind: generation.kind, status: 'FAILED', code: input.code },
    });
  },
});

/**
 * Chama a IA fora da transação, com uma nova tentativa só para saída fora do
 * formato (§9.2). Falha fica registrada e vira erro claro para a pessoa.
 */
export async function callProvider<T>(
  deps: CoreDeps,
  actor: Actor,
  meta: RequestMeta,
  generationId: string,
  call: () => Promise<AiStructuredResult<T>>,
): Promise<AiStructuredResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (!(error instanceof AiProviderError && error.code === 'INVALID_OUTPUT')) break;
    }
  }
  const failure = lastError instanceof AiProviderError ? lastError : null;
  await failGeneration(
    deps,
    actor,
    {
      generationId,
      code: failure?.code ?? 'UNEXPECTED',
      model: failure?.details.model ?? null,
      ...(failure?.details.usage ? { usage: failure.details.usage } : {}),
      ...(failure?.details.latencyMs !== undefined ? { latencyMs: failure.details.latencyMs } : {}),
    },
    meta,
  );
  if (!failure) deps.logger.error({ err: lastError, generationId }, 'Falha inesperada na IA');
  throw aiFailure(lastError);
}

/**
 * "Gerar abordagem com IA" (M12; docs/AI-SDR.md §10): rascunho com avisos,
 * nunca enviado sem a aprovação de uma pessoa.
 */
export async function generateOutreach(
  deps: CoreDeps,
  actor: Actor,
  input: z.input<typeof generateOutreachInput>,
  meta: RequestMeta = {},
) {
  const begun = await beginOutreach(deps, actor, input, meta);
  if (!begun.call) return begun.generation!;
  const { generationId, system, input: userMessage } = begun.call;
  const result = await callProvider(deps, actor, meta, generationId, () =>
    deps.ai.generateStructured({
      task: 'outreach_message',
      system,
      input: userMessage,
      schema: outreachMessageSchema,
      effort: deps.aiLimits.effortGeneration,
      maxOutputTokens: OUTREACH_MAX_OUTPUT_TOKENS,
    }),
  );
  return finishOutreach(deps, actor, { generationId, result }, meta);
}
