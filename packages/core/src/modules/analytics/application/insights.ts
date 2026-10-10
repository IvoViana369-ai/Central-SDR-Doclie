import { z } from 'zod';
import { AiProviderError, type AiStructuredResult, type AiTokenUsage } from '../../../ports/ai';
import { systemActor, type Actor } from '../../../shared/actor';
import {
  BusinessRuleError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
  type UseCaseContext,
} from '../../../shared/use-case';
import {
  alertBudget,
  assertAiAllowance,
  estimateCostUsd,
  IN_PROGRESS,
  INSIGHTS_MAX_OUTPUT_TOKENS,
  PORTFOLIO_INSIGHTS_PROMPT,
  PORTFOLIO_INSIGHTS_SYSTEM,
  portfolioInsightsUserMessage,
  usageColumns,
} from '../../ai-sdr';
import { roleHasPermission } from '../../identity';
import { loadContactRules } from '../../settings';
import { insightFeedbackInput, insightsInput, refreshInsightsInput } from '../contracts/schemas';
import {
  checkInsightText,
  INSIGHT_PRIORITY,
  INSIGHT_TYPE_LABELS,
  insightsOutputSchema,
  templateText,
  type InsightFact,
  type InsightsOutput,
  type InsightType,
} from '../domain/insights';
import { bestApproach, computeInsightFacts, type InsightAudience } from '../infra/insight-facts';

/**
 * Insights da carteira (F11-04; docs/AI-SDR.md §13). Os fatos vêm do SQL; a
 * IA só reescreve cada um, e o texto dela só vale se passar na conferência
 * (números do fato, tamanho, sem contato nem link). Sem IA (orçamento, cota,
 * falha ou texto recusado), vale o texto padrão. Custo em `ai_generations`
 * (tipo INSIGHT, sem lead).
 *
 * Público: a equipe (gestão) e cada SDR (a própria carteira). Gerados todo
 * dia às 07h05 (job `analytics.insights`) ou quando a gestão pede.
 */

/** Validade de um lote: passa de um dia para o outro, mesmo se o job atrasar. */
const VALID_HOURS = 36;
/** Insights antigos saem depois disto (só contagens; sem dado pessoal). */
const RETENTION_DAYS = 180;
const INSIGHTS_EFFORT = 'low' as const;

type AudienceInput = z.infer<typeof refreshInsightsInput>;

const canSeeTeam = (ctx: UseCaseContext) =>
  ctx.actor.kind !== 'user' || roleHasPermission(ctx.actor.role, 'report.read');

async function resolveAudience(
  ctx: UseCaseContext,
  input: AudienceInput,
): Promise<InsightAudience> {
  if (input.scope === 'TEAM') return { scope: 'TEAM' };
  if (!input.userId) {
    throw new ValidationError([{ path: 'userId', message: 'Informe a pessoa.' }]);
  }
  const user = await ctx.tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, territories: { select: { stateUf: true, municipalityCode: true } } },
  });
  if (!user) throw new NotFoundError('Pessoa não encontrada.');
  return { scope: 'USER', userId: user.id, territories: user.territories };
}

const beginInsights = defineUseCase({
  name: 'analytics.insights.begin',
  access: 'report.read',
  input: refreshInsightsInput,
  async run(ctx, input) {
    const audience = await resolveAudience(ctx, input);
    const rules = await loadContactRules(ctx.tx);
    const facts = await computeInsightFacts(ctx.tx, audience, ctx.now, {
      forgottenAfterDays: rules.forgottenAfterDays,
      bestApproach: await bestApproach(ctx.tx, ctx.now),
    });
    if (facts.length === 0) return { facts, call: null, skipped: null };
    const requestedById = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    try {
      await assertAiAllowance(ctx, requestedById);
    } catch (error) {
      // Sem orçamento ou cota: os insights saem com o texto padrão.
      if (error instanceof BusinessRuleError || error instanceof RateLimitError) {
        return { facts, call: null, skipped: error.message };
      }
      throw error;
    }
    const items = facts.map((fact) => ({ type: fact.type, text: templateText(fact) }));
    const pending = await ctx.tx.aiGeneration.create({
      data: {
        leadId: null,
        requestedById,
        kind: 'INSIGHT',
        promptId: PORTFOLIO_INSIGHTS_PROMPT.id,
        promptVersion: PORTFOLIO_INSIGHTS_PROMPT.version,
        provider: ctx.deps.ai.name,
        model: ctx.deps.ai.models.generation,
        params: toJson({ effort: INSIGHTS_EFFORT, maxOutputTokens: INSIGHTS_MAX_OUTPUT_TOKENS }),
        inputSnapshot: toJson({ audience: audience.scope, facts: items }),
        status: 'FAILED',
        errorCode: IN_PROGRESS,
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    return {
      facts,
      call: {
        generationId: pending.id,
        input: portfolioInsightsUserMessage({ audience: audience.scope, facts: items }),
      },
      skipped: null,
    };
  },
});

interface AiFailure {
  code: string;
  model: string | null;
  usage?: AiTokenUsage;
  latencyMs?: number;
}

/** Chama a IA fora da transação; nova tentativa só para saída fora do formato. */
async function callAi(
  deps: CoreDeps,
  input: string,
): Promise<{ result: AiStructuredResult<InsightsOutput> } | { failure: AiFailure }> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return {
        result: await deps.ai.generateStructured({
          task: 'portfolio_insights',
          system: PORTFOLIO_INSIGHTS_SYSTEM,
          input,
          schema: insightsOutputSchema,
          effort: INSIGHTS_EFFORT,
          maxOutputTokens: INSIGHTS_MAX_OUTPUT_TOKENS,
        }),
      };
    } catch (error) {
      last = error;
      if (!(error instanceof AiProviderError && error.code === 'INVALID_OUTPUT')) break;
    }
  }
  if (!(last instanceof AiProviderError)) {
    deps.logger.error({ err: last }, 'Falha inesperada na IA (insights)');
    return { failure: { code: 'UNEXPECTED', model: null } };
  }
  return {
    failure: {
      code: last.code,
      model: last.details.model ?? null,
      ...(last.details.usage ? { usage: last.details.usage } : {}),
      ...(last.details.latencyMs !== undefined ? { latencyMs: last.details.latencyMs } : {}),
    },
  };
}

const finishInsights = defineUseCase({
  name: 'analytics.insights.finish',
  access: 'report.read',
  input: refreshInsightsInput.extend({
    facts: z.custom<InsightFact[]>(),
    generationId: z.uuid().nullable(),
    result: z.custom<AiStructuredResult<InsightsOutput>>().nullable(),
    failure: z.custom<AiFailure>().nullable(),
    skipped: z.string().nullable(),
  }),
  async run(ctx, input) {
    const { facts, generationId, result, failure } = input;
    const texts = facts.map(templateText);
    const fromAi = facts.map(() => false);
    const rejected: { type: InsightType; reason: string }[] = [];

    if (generationId && result) {
      facts.forEach((fact, index) => {
        const candidate = result.data.insights.find((item) => item.type === fact.type);
        const check = candidate
          ? checkInsightText(candidate.text, fact)
          : ({ ok: false, reason: 'ausente' } as const);
        if (check.ok) {
          // Igual ao texto padrão (ex.: provedor simulado): não é "redigido pela IA".
          const text = candidate!.text.trim();
          fromAi[index] = text !== texts[index];
          texts[index] = text;
        } else {
          rejected.push({ type: fact.type, reason: check.reason });
        }
      });
      const cost = estimateCostUsd(result.model, result.usage);
      await ctx.tx.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: 'GENERATED',
          errorCode: null,
          model: result.model,
          output: toJson(result.data),
          guardrailFlags: toJson(rejected),
          stopReason: result.stopReason,
          ...usageColumns(result.usage, cost, result.latencyMs),
        },
      });
      await alertBudget(ctx, cost ?? 0);
    } else if (generationId && failure) {
      const model = failure.model ?? ctx.deps.ai.models.generation;
      const cost = failure.usage ? estimateCostUsd(model, failure.usage) : null;
      await ctx.tx.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: 'FAILED',
          errorCode: failure.code,
          model,
          ...usageColumns(failure.usage, cost, failure.latencyMs),
        },
      });
      await alertBudget(ctx, cost ?? 0);
    }

    // O lote novo substitui o anterior do mesmo público.
    const audienceUserId = input.scope === 'USER' ? (input.userId ?? null) : null;
    await ctx.tx.insight.updateMany({
      where: { scope: input.scope, audienceUserId, validUntil: { gt: ctx.now } },
      data: { validUntil: ctx.now },
    });
    const validUntil = new Date(ctx.now.getTime() + VALID_HOURS * 3_600_000);
    if (facts.length > 0) {
      await ctx.tx.insight.createMany({
        data: facts.map((fact, index) => ({
          generatedAt: ctx.now,
          scope: input.scope,
          audienceUserId,
          type: fact.type,
          text: texts[index]!,
          data: toJson(fact),
          source: fromAi[index] ? ('AI' as const) : ('TEMPLATE' as const),
          aiGenerationId: generationId,
          priority: INSIGHT_PRIORITY[fact.type],
          validUntil,
        })),
      });
    }
    const summary = {
      scope: input.scope,
      userId: audienceUserId,
      count: facts.length,
      fromAi: fromAi.filter(Boolean).length,
      rejected: rejected.length,
      ...(failure ? { aiError: failure.code } : {}),
      ...(input.skipped ? { skipped: input.skipped } : {}),
    };
    await ctx.audit({
      action: 'insight.generate',
      entityType: 'insight',
      entityId: generationId,
      metadata: summary,
    });
    return summary;
  },
});

/**
 * Gera os insights de um público agora (gestão: botão "Atualizar"; worker:
 * todo dia). Uma chamada à IA por público, só quando há fatos.
 */
export async function generateInsights(
  deps: CoreDeps,
  actor: Actor,
  input: z.input<typeof refreshInsightsInput>,
  meta: RequestMeta = {},
) {
  const audience = refreshInsightsInput.parse(input);
  const begun = await beginInsights(deps, actor, audience, meta);
  const outcome = begun.call ? await callAi(deps, begun.call.input) : null;
  return finishInsights(
    deps,
    actor,
    {
      ...audience,
      facts: begun.facts,
      generationId: begun.call?.generationId ?? null,
      result: outcome && 'result' in outcome ? outcome.result : null,
      failure: outcome && 'failure' in outcome ? outcome.failure : null,
      skipped: begun.skipped,
    },
    meta,
  );
}

/** Job `analytics.insights` (07h05 em Fortaleza): a equipe e cada SDR ativo. */
export async function runInsightsJob(deps: CoreDeps) {
  const actor = systemActor('analytics.insights');
  const now = deps.clock.now();
  const sdrs = await deps.db.user.findMany({
    where: { role: 'SDR', status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const audiences: AudienceInput[] = [
    { scope: 'TEAM' },
    ...sdrs.map((u) => ({ scope: 'USER' as const, userId: u.id })),
  ];
  const result = { audiences: 0, insights: 0, fromAi: 0, errors: 0, purged: 0 };
  for (const audience of audiences) {
    try {
      const summary = await generateInsights(deps, actor, audience);
      result.audiences += 1;
      result.insights += summary.count;
      result.fromAi += summary.fromAi;
    } catch (error) {
      // Um público com problema não impede os outros.
      result.errors += 1;
      deps.logger.error({ err: error, ...audience }, 'Falha ao gerar insights');
    }
  }
  const purged = await deps.db.insight.deleteMany({
    where: { generatedAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } },
  });
  result.purged = purged.count;
  deps.logger.info(result, 'Insights da carteira gerados');
  return result;
}

/**
 * Insights vigentes: a gestão vê os da equipe (ou os de uma pessoa); os
 * demais, os da própria carteira.
 */
export const getInsights = defineUseCase({
  name: 'analytics.insights',
  access: 'authenticated',
  input: insightsInput,
  async run(ctx, input) {
    const team = canSeeTeam(ctx);
    const userId = team ? (input.userId ?? null) : ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const scope = userId ? ('USER' as const) : ('TEAM' as const);
    const rows = await ctx.tx.insight.findMany({
      where: { scope, audienceUserId: userId, validUntil: { gt: ctx.now } },
      orderBy: [{ priority: 'desc' }, { generatedAt: 'desc' }],
      select: {
        id: true,
        type: true,
        text: true,
        source: true,
        priority: true,
        feedback: true,
        generatedAt: true,
        data: true,
      },
    });
    return {
      scope,
      userId,
      canRefresh: team,
      generatedAt: rows[0]?.generatedAt ?? null,
      items: rows.map((r) => ({
        ...r,
        label: INSIGHT_TYPE_LABELS[r.type as InsightType] ?? r.type,
      })),
    };
  },
});

export type InsightsView = Awaited<ReturnType<typeof getInsights>>;

/** "Útil" ou "não útil": quem vê o insight avalia (melhora a escolha dos fatos). */
export const rateInsight = defineUseCase({
  name: 'analytics.insights.rate',
  access: 'authenticated',
  input: insightFeedbackInput,
  async run(ctx, input) {
    const insight = await ctx.tx.insight.findUnique({
      where: { id: input.insightId },
      select: { id: true, scope: true, audienceUserId: true, type: true },
    });
    const own = ctx.actor.kind === 'user' && insight?.audienceUserId === ctx.actor.id;
    if (!insight || (!own && !canSeeTeam(ctx))) throw new NotFoundError('Insight não encontrado.');
    await ctx.tx.insight.update({
      where: { id: insight.id },
      data: {
        feedback: input.feedback,
        feedbackById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        feedbackAt: ctx.now,
      },
    });
    await ctx.audit({
      action: 'insight.feedback',
      entityType: 'insight',
      entityId: insight.id,
      metadata: { type: insight.type, feedback: input.feedback },
    });
    return { id: insight.id, feedback: input.feedback };
  },
});
