import {
  AiProviderError,
  type AiEffort,
  type AiProvider,
  type AiStructuredResult,
  type AiTokenUsage,
} from '../../../ports/ai';
import { detectOptOut } from '../../messaging';
import { DEFAULT_OPT_OUT_KEYWORDS } from '../../settings';
import { buildOutreachContext, type OutreachContext } from '../domain/context';
import { estimateCostUsd } from '../domain/cost';
import { checkReplyClassification, clampConfidence } from '../domain/guardrails';
import type { OutreachKind } from '../domain/kinds';
import { DEFAULT_AI_RULES, type AiRules } from '../domain/rules';
import {
  LOW_CONFIDENCE,
  outreachMessageSchema,
  replyClassificationSchema,
  type OutreachMessage,
  type ReplyClassificationOutput,
} from '../domain/schemas';
import {
  CLASSIFICATION_MAX_OUTPUT_TOKENS,
  OUTREACH_MAX_OUTPUT_TOKENS,
  OUTREACH_PROMPT,
  outreachSystemPrompt,
  outreachUserMessage,
  REPLY_CLASSIFICATION_PROMPT,
  REPLY_CLASSIFICATION_SYSTEM,
  replyClassificationUserMessage,
} from '../prompts';
import { checkEvalMessage, isViolation, type EvalFlag } from './checks';
import {
  EVAL_PRESENCE_CITIES,
  EVAL_SDR_NAME,
  type EvalTag,
  type OutreachEvalCase,
  type ReplyEvalCase,
} from './dataset';
import type { RubricSummary } from './rubric';

/**
 * Executor da avaliação offline (docs/AI-SDR.md §14). Monta cada pedido com
 * o mesmo ContextBuilder e os mesmos prompts da produção, chama o provedor
 * (falso no CI; real só com aprovação, porque custa) e aplica as verificações
 * automáticas. Não toca no banco: o conjunto é todo fictício.
 */

export const EVAL_REPORT_FORMAT = 'docline-ai-eval';
export const EVAL_REPORT_VERSION = 1;

const CHANNEL_LABELS = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', EMAIL: 'E-mail' } as const;

/** Falhas que invalidam a rodada inteira (chave ou configuração): para na hora. */
const FATAL_CODES = new Set(['AUTH', 'BAD_REQUEST']);

export interface OutreachEvalResult {
  caseId: string;
  leadId: string;
  kind: OutreachKind;
  tags: EvalTag[];
  status: 'OK' | 'FAILED';
  errorCode: string | null;
  message: string | null;
  chars: number | null;
  output: OutreachMessage | null;
  contextWarnings: string[];
  flags: EvalFlag[];
  violations: string[];
  warnings: string[];
  model: string | null;
  usage: AiTokenUsage | null;
  costUsd: number | null;
  latencyMs: number | null;
  fallbackUsed: boolean;
}

export interface ReplyEvalResult {
  caseId: string;
  expected: string;
  expectOptOut: boolean;
  status: 'OK' | 'FAILED';
  errorCode: string | null;
  output: ReplyClassificationOutput | null;
  correct: boolean;
  optOutCaught: boolean | null;
  /** Regra determinística de opt-out (roda antes da IA na produção). */
  ruleOptOut: 'CERTAIN' | 'POSSIBLE' | 'NONE';
  lowConfidence: boolean;
  model: string | null;
  usage: AiTokenUsage | null;
  costUsd: number | null;
  latencyMs: number | null;
}

export interface EvalReport {
  format: typeof EVAL_REPORT_FORMAT;
  version: typeof EVAL_REPORT_VERSION;
  meta: {
    startedAt: string;
    finishedAt: string;
    provider: string;
    models: { generation: string; classification: string };
    effort: { generation: AiEffort; classification: AiEffort };
    prompts: { outreach: string; classification: string };
    rules: AiRules;
    selection: string | null;
  };
  outreach: { summary: OutreachSummary; results: OutreachEvalResult[] };
  replies: { summary: ReplySummary; results: ReplyEvalResult[] };
  /** Notas da rubrica humana, anexadas depois (pnpm ai:eval score). */
  rubric?: RubricSummary;
}

export interface EvalOptions {
  cases: readonly OutreachEvalCase[];
  replyCases: readonly ReplyEvalCase[];
  effort: { generation: AiEffort; classification: AiEffort };
  rules?: AiRules;
  /** Pedidos simultâneos ao provedor (padrão 4). */
  concurrency?: number;
  /** Descrição da seleção de casos (gravada no relatório). */
  selection?: string | null;
  onProgress?: (done: number, total: number) => void;
  clock?: () => Date;
}

async function withRetry<T>(call: () => Promise<AiStructuredResult<T>>) {
  // Uma nova tentativa só para saída fora do formato, como na produção (§9.2).
  try {
    return await call();
  } catch (error) {
    if (error instanceof AiProviderError && error.code === 'INVALID_OUTPUT') return call();
    throw error;
  }
}

interface Failure {
  code: string;
  model: string | null;
  usage: AiTokenUsage | null;
}

/** Falha de um caso (com o custo, se houve consumo); chave ou configuração errada para tudo. */
function failure(error: unknown): Failure {
  if (!(error instanceof AiProviderError)) return { code: 'UNEXPECTED', model: null, usage: null };
  if (FATAL_CODES.has(error.code)) throw error;
  return {
    code: error.code,
    model: error.details.model ?? null,
    usage: error.details.usage ?? null,
  };
}

const failureCost = (f: Failure) => (f.model && f.usage ? estimateCostUsd(f.model, f.usage) : 0);

async function pool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) await work(items[next++]!);
    },
  );
  await Promise.all(workers);
}

export function evalContext(c: OutreachEvalCase, rules: AiRules): OutreachContext {
  return buildOutreachContext(c.source, {
    kind: c.kind,
    channelLabel: CHANNEL_LABELS[c.channel],
    sdrName: EVAL_SDR_NAME,
    approach: c.approach,
    sdrInstructions: c.sdrInstructions,
    maxChars: rules.maxChars[c.kind],
    optOutLine: rules.optOutRequiredKinds.includes(c.kind) ? rules.optOutLine : null,
    facts: c.facts.map((f) => ({ key: f.key, version: f.version })),
  });
}

/** Pedido de geração idêntico ao da produção (generateOutreach). */
export function outreachEvalRequest(c: OutreachEvalCase, rules: AiRules, effort: AiEffort) {
  return {
    task: 'outreach_message' as const,
    system: outreachSystemPrompt(c.facts),
    input: outreachUserMessage(evalContext(c, rules)),
    schema: outreachMessageSchema,
    effort,
    maxOutputTokens: OUTREACH_MAX_OUTPUT_TOKENS,
  };
}

/** Pedido de classificação idêntico ao da produção (suggestReplyClassification). */
export function replyEvalRequest(c: ReplyEvalCase, effort: AiEffort) {
  return {
    task: 'reply_classification' as const,
    system: REPLY_CLASSIFICATION_SYSTEM,
    input: replyClassificationUserMessage(c),
    schema: replyClassificationSchema,
    effort,
    maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
  };
}

export async function runEval(provider: AiProvider, options: EvalOptions): Promise<EvalReport> {
  const clock = options.clock ?? (() => new Date());
  const rules = options.rules ?? DEFAULT_AI_RULES;
  const concurrency = options.concurrency ?? 4;
  const startedAt = clock();
  const total = options.cases.length + options.replyCases.length;
  let done = 0;
  const tick = () => options.onProgress?.(++done, total);

  // 1. Geração de mensagens.
  const generated = new Map<
    string,
    { result: AiStructuredResult<OutreachMessage> } | { error: Failure }
  >();
  await pool(options.cases, concurrency, async (c) => {
    try {
      const result = await withRetry(() =>
        provider.generateStructured(outreachEvalRequest(c, rules, options.effort.generation)),
      );
      generated.set(c.id, { result });
    } catch (error) {
      generated.set(c.id, { error: failure(error) });
    }
    tick();
  });

  // 2. Verificações (depois de tudo gerado: a comparação entre mensagens não
  //    depende da ordem em que as respostas chegaram).
  const messagesByKind = new Map<OutreachKind, { caseId: string; text: string }[]>();
  for (const c of options.cases) {
    const entry = generated.get(c.id);
    if (entry && 'result' in entry) {
      const list = messagesByKind.get(c.kind) ?? [];
      list.push({ caseId: c.id, text: entry.result.data.message });
      messagesByKind.set(c.kind, list);
    }
  }
  const outreachResults = options.cases.map((c): OutreachEvalResult => {
    const entry = generated.get(c.id)!;
    const context = evalContext(c, rules);
    const base = {
      caseId: c.id,
      leadId: c.leadId,
      kind: c.kind,
      tags: c.tags,
      contextWarnings: context.warnings,
    };
    if ('error' in entry) {
      return {
        ...base,
        status: 'FAILED',
        errorCode: entry.error.code,
        message: null,
        chars: null,
        output: null,
        flags: [],
        violations: [],
        warnings: [],
        model: entry.error.model,
        usage: entry.error.usage,
        costUsd: failureCost(entry.error),
        latencyMs: null,
        fallbackUsed: false,
      };
    }
    const { result } = entry;
    const text = result.data.message.trim();
    const flags = checkEvalMessage(text, {
      kind: c.kind,
      rules,
      context,
      factTexts: c.facts.map((f) => f.content),
      presenceCities: c.facts.length > 0 ? EVAL_PRESENCE_CITIES : [],
      otherMessages: (messagesByKind.get(c.kind) ?? [])
        .filter((m) => m.caseId !== c.id)
        .map((m) => m.text),
    });
    return {
      ...base,
      status: 'OK',
      errorCode: null,
      message: text,
      chars: text.length,
      output: result.data,
      flags,
      violations: [...new Set(flags.filter(isViolation).map((f) => f.code))],
      warnings: [...new Set(flags.filter((f) => !isViolation(f)).map((f) => f.code))],
      model: result.model,
      usage: result.usage,
      costUsd: estimateCostUsd(result.model, result.usage),
      latencyMs: result.latencyMs,
      fallbackUsed: result.fallbackUsed,
    };
  });

  // 3. Classificação de respostas.
  const replyResults = new Map<string, ReplyEvalResult>();
  await pool(options.replyCases, concurrency, async (c) => {
    const base = {
      caseId: c.id,
      expected: c.expected,
      expectOptOut: c.expectOptOut,
      ruleOptOut: detectOptOut(c.reply, DEFAULT_OPT_OUT_KEYWORDS).level,
    };
    try {
      const result = await withRetry(() =>
        provider.generateStructured(replyEvalRequest(c, options.effort.classification)),
      );
      const output = { ...result.data, confidence: clampConfidence(result.data.confidence) };
      const optOutSignal = checkReplyClassification(output).some(
        (f) => f.code === 'OPT_OUT_SIGNAL',
      );
      replyResults.set(c.id, {
        ...base,
        status: 'OK',
        errorCode: null,
        output,
        correct: output.label === c.expected,
        optOutCaught: c.expectOptOut ? optOutSignal : null,
        lowConfidence: output.confidence < LOW_CONFIDENCE,
        model: result.model,
        usage: result.usage,
        costUsd: estimateCostUsd(result.model, result.usage),
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      const failed = failure(error);
      replyResults.set(c.id, {
        ...base,
        status: 'FAILED',
        errorCode: failed.code,
        output: null,
        correct: false,
        optOutCaught: c.expectOptOut ? false : null,
        lowConfidence: false,
        model: failed.model,
        usage: failed.usage,
        costUsd: failureCost(failed),
        latencyMs: null,
      });
    }
    tick();
  });
  const replies = options.replyCases.map((c) => replyResults.get(c.id)!);

  return {
    format: EVAL_REPORT_FORMAT,
    version: EVAL_REPORT_VERSION,
    meta: {
      startedAt: startedAt.toISOString(),
      finishedAt: clock().toISOString(),
      provider: provider.name,
      models: provider.models,
      effort: options.effort,
      prompts: {
        outreach: `${OUTREACH_PROMPT.id}@v${OUTREACH_PROMPT.version}`,
        classification: `${REPLY_CLASSIFICATION_PROMPT.id}@v${REPLY_CLASSIFICATION_PROMPT.version}`,
      },
      rules,
      selection: options.selection ?? null,
    },
    outreach: { summary: summarizeOutreach(outreachResults), results: outreachResults },
    replies: { summary: summarizeReplies(replies), results: replies },
  };
}

// --- Resumos ----------------------------------------------------------------

const rate = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function sumCosts(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  return Math.round(values.reduce<number>((s, v) => s + v!, 0) * 1_000_000) / 1_000_000;
}

function sumUsage(usages: (AiTokenUsage | null)[]) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of usages) {
    if (!u) continue;
    total.input += u.inputTokens;
    total.output += u.outputTokens;
    total.cacheRead += u.cacheReadTokens;
    total.cacheWrite += u.cacheWriteTokens;
  }
  return total;
}

const countBy = (items: string[]) =>
  items.reduce<Record<string, number>>(
    (acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }),
    {},
  );

export function summarizeOutreach(results: readonly OutreachEvalResult[]) {
  const ok = results.filter((r) => r.status === 'OK');
  const withViolation = ok.filter((r) => r.violations.length > 0);
  const group = <K extends string>(keyOf: (r: OutreachEvalResult) => K[]) => {
    const groups: Record<
      string,
      { cases: number; generated: number; withViolation: number; avgChars: number | null }
    > = {};
    for (const r of results) {
      for (const key of keyOf(r)) {
        const g = (groups[key] ??= { cases: 0, generated: 0, withViolation: 0, avgChars: null });
        g.cases += 1;
        if (r.status === 'OK') {
          g.avgChars = ((g.avgChars ?? 0) * g.generated + r.chars!) / (g.generated + 1);
          g.generated += 1;
          if (r.violations.length > 0) g.withViolation += 1;
        }
      }
    }
    for (const g of Object.values(groups)) if (g.avgChars !== null) g.avgChars = round(g.avgChars);
    return groups;
  };
  const latencies = ok.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
  return {
    cases: results.length,
    generated: ok.length,
    failed: results.length - ok.length,
    failuresByCode: countBy(results.flatMap((r) => (r.errorCode ? [r.errorCode] : []))),
    withViolation: withViolation.length,
    violationRate: rate(withViolation.length, ok.length),
    withWarning: ok.filter((r) => r.warnings.length > 0).length,
    flagsByCode: countBy(ok.flatMap((r) => [...r.violations, ...r.warnings])),
    injectionFollowed: ok.filter((r) => r.violations.includes('INJECTION_FOLLOWED')).length,
    avgChars: ok.length ? round(ok.reduce((s, r) => s + r.chars!, 0) / ok.length) : null,
    byKind: group((r) => [r.kind]),
    byTag: group((r) => r.tags),
    costUsd: sumCosts(results.map((r) => r.costUsd)),
    tokens: sumUsage(results.map((r) => r.usage)),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    fallbackUsed: ok.filter((r) => r.fallbackUsed).length,
  };
}

export type OutreachSummary = ReturnType<typeof summarizeOutreach>;

export function summarizeReplies(results: readonly ReplyEvalResult[]) {
  const ok = results.filter((r) => r.status === 'OK');
  const optOutCases = results.filter((r) => r.expectOptOut);
  return {
    cases: results.length,
    classified: ok.length,
    failed: results.length - ok.length,
    accuracy: results.length ? rate(ok.filter((r) => r.correct).length, results.length) : null,
    /** Pedidos de opt-out percebidos (classe OPT_OUT ou indício): a meta é 100%. */
    optOutRecall: optOutCases.length
      ? rate(optOutCases.filter((r) => r.optOutCaught).length, optOutCases.length)
      : null,
    missedOptOuts: optOutCases.filter((r) => !r.optOutCaught).map((r) => r.caseId),
    /** Regra determinística sozinha, e a regra ou a IA (a rede de segurança completa). */
    ruleOptOutRecall: optOutCases.length
      ? rate(optOutCases.filter((r) => r.ruleOptOut !== 'NONE').length, optOutCases.length)
      : null,
    missedByRuleAndAi: optOutCases
      .filter((r) => !r.optOutCaught && r.ruleOptOut === 'NONE')
      .map((r) => r.caseId),
    lowConfidence: ok.filter((r) => r.lowConfidence).length,
    mismatches: ok
      .filter((r) => !r.correct)
      .map((r) => ({ caseId: r.caseId, expected: r.expected, got: r.output!.label })),
    costUsd: sumCosts(results.map((r) => r.costUsd)),
    tokens: sumUsage(results.map((r) => r.usage)),
  };
}

export type ReplySummary = ReturnType<typeof summarizeReplies>;

/**
 * Estimativa de custo **antes** de rodar com um provedor real: entrada pelo
 * tamanho dos prompts (≈ 4 caracteres por token) e saída pelo valor
 * informado (o raciocínio do modelo conta como saída). Sem preço cadastrado
 * para o modelo, devolve null.
 */
export function estimateEvalCostUsd(
  models: { generation: string; classification: string },
  cases: readonly OutreachEvalCase[],
  replyCases: readonly ReplyEvalCase[],
  options: { effort?: AiEffort; rules?: AiRules; outputTokensPerCase?: number } = {},
): number | null {
  const rules = options.rules ?? DEFAULT_AI_RULES;
  const output = options.outputTokensPerCase ?? 1500;
  const tokens = (text: string) => Math.ceil(text.length / 4);
  let total = 0;
  for (const c of cases) {
    const request = outreachEvalRequest(c, rules, options.effort ?? 'medium');
    const cost = estimateCostUsd(models.generation, {
      inputTokens: tokens(request.system) + tokens(request.input),
      outputTokens: output,
    });
    if (cost === null) return null;
    total += cost;
  }
  for (const c of replyCases) {
    const request = replyEvalRequest(c, options.effort ?? 'low');
    const cost = estimateCostUsd(models.classification, {
      inputTokens: tokens(request.system) + tokens(request.input),
      outputTokens: Math.round(output / 3),
    });
    if (cost === null) return null;
    total += cost;
  }
  return Math.round(total * 100) / 100;
}
