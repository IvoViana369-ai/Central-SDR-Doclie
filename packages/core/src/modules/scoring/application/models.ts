import type { ScoreBand } from '@docline/db';
import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { CRITERIA, CRITERION_KEYS, criterionOf } from '../domain/criteria';
import {
  computeScore,
  NORMALIZATION_LABELS,
  SCORE_BAND_LABELS,
  SCORE_BANDS,
  validateBands,
  type BandRange,
} from '../domain/score';
import { scoringModelIdInput, updateScoringDraftInput } from '../contracts/schemas';
import { loadActiveModel, loadScoreFacts, toModelInput } from '../infra/recompute';

const modelInclude = {
  rules: { orderBy: { position: 'asc' as const } },
  createdBy: { select: { name: true } },
  activatedBy: { select: { name: true } },
};

async function requireModel(ctx: UseCaseContext, modelId: string) {
  const model = await ctx.tx.scoringModel.findUnique({
    where: { id: modelId },
    include: modelInclude,
  });
  if (!model) throw new NotFoundError('Modelo de score não encontrado.');
  return model;
}

type ModelRow = Awaited<ReturnType<typeof requireModel>>;

function describeModel(model: ModelRow) {
  return {
    id: model.id,
    name: model.name,
    version: model.version,
    status: model.status,
    normalization: model.normalization,
    normalizationLabel: NORMALIZATION_LABELS[model.normalization],
    bands: model.bands as unknown as BandRange[],
    notes: model.notes,
    createdByName: model.createdBy?.name ?? null,
    createdAt: model.createdAt,
    activatedAt: model.activatedAt,
    activatedByName: model.activatedBy?.name ?? null,
    rules: model.rules.map((r) => {
      const criterion = criterionOf(r.criterionKey);
      const params = criterion?.params.safeParse(r.params ?? {});
      return {
        id: r.id,
        criterionKey: r.criterionKey,
        label: criterion && params?.success ? criterion.describe(params.data) : r.criterionKey,
        params: (r.params ?? {}) as Record<string, unknown>,
        points: r.points,
        active: r.active,
        description: r.description,
        availability: criterion?.availability ?? null,
      };
    }),
  };
}

/** Critérios disponíveis no código, para a tela de pesos. */
export const SCORING_CRITERIA = CRITERION_KEYS.map((key) => {
  const c = CRITERIA[key] as { key: string; label: string; availability?: string };
  return { key: c.key, label: c.label, availability: c.availability ?? null };
});

/** Modelo ativo e regras (a ficha do lead explica o score com ele). */
export const getActiveScoringModel = defineUseCase({
  name: 'scoring.active',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    const model = await ctx.tx.scoringModel.findFirst({
      where: { status: 'ACTIVE' },
      include: modelInclude,
    });
    if (!model) throw new NotFoundError('Nenhum modelo de score ativo.');
    return describeModel(model);
  },
});

/** Versões do modelo (ativa, rascunho e arquivadas) e os critérios disponíveis. */
export const listScoringModels = defineUseCase({
  name: 'scoring.list',
  access: 'settings.manage',
  input: z.object({}),
  async run(ctx) {
    const models = await ctx.tx.scoringModel.findMany({
      orderBy: { version: 'desc' },
      include: modelInclude,
      take: 30,
    });
    return { models: models.map(describeModel), criteria: SCORING_CRITERIA };
  },
});

/**
 * Abre um rascunho a partir do modelo ativo (só um rascunho por vez: se já
 * houver, devolve o existente).
 */
export const createScoringDraft = defineUseCase({
  name: 'scoring.createDraft',
  access: 'settings.manage',
  input: z.object({}),
  async run(ctx) {
    const existing = await ctx.tx.scoringModel.findFirst({
      where: { status: 'DRAFT' },
      include: modelInclude,
    });
    if (existing) return describeModel(existing);
    const active = await ctx.tx.scoringModel.findFirst({
      where: { status: 'ACTIVE' },
      include: { rules: { orderBy: { position: 'asc' } } },
    });
    if (!active) throw new NotFoundError('Nenhum modelo de score ativo para copiar.');
    const last = await ctx.tx.scoringModel.aggregate({ _max: { version: true } });
    const draft = await ctx.tx.scoringModel.create({
      data: {
        name: active.name,
        version: (last._max.version ?? 0) + 1,
        status: 'DRAFT',
        normalization: active.normalization,
        bands: active.bands as object,
        notes: null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        rules: {
          createMany: {
            data: active.rules.map((r) => ({
              criterionKey: r.criterionKey,
              params: r.params as object,
              points: r.points,
              active: r.active,
              position: r.position,
              description: r.description,
            })),
          },
        },
      },
      include: modelInclude,
    });
    await ctx.audit({
      action: 'scoring.draft_create',
      entityType: 'scoring_model',
      entityId: draft.id,
      metadata: { version: draft.version, from: active.version },
    });
    return describeModel(draft);
  },
});

async function requireDraft(ctx: UseCaseContext, modelId: string) {
  const model = await requireModel(ctx, modelId);
  if (model.status !== 'DRAFT') {
    throw new BusinessRuleError('Só o rascunho pode ser alterado. Abra um rascunho novo.');
  }
  return model;
}

/** Salva o rascunho: nome, normalização, faixas e regras (critérios e parâmetros validados). */
export const updateScoringDraft = defineUseCase({
  name: 'scoring.updateDraft',
  access: 'settings.manage',
  input: updateScoringDraftInput,
  async run(ctx, input) {
    const draft = await requireDraft(ctx, input.modelId);
    const issues: { path: string; message: string }[] = [];
    for (const message of validateBands(input.bands as BandRange[])) {
      issues.push({ path: 'bands', message });
    }
    input.rules.forEach((rule, i) => {
      const criterion = criterionOf(rule.criterionKey);
      if (!criterion) {
        issues.push({ path: `rules.${i}.criterionKey`, message: 'Critério desconhecido.' });
        return;
      }
      const params = criterion.params.safeParse(rule.params);
      if (!params.success) {
        issues.push({
          path: `rules.${i}.params`,
          message: `Parâmetros inválidos para "${criterion.label}".`,
        });
      }
    });
    if (issues.length > 0) throw new ValidationError(issues);

    await ctx.tx.scoringRule.deleteMany({ where: { modelId: draft.id } });
    await ctx.tx.scoringModel.update({
      where: { id: draft.id },
      data: {
        name: input.name,
        notes: input.notes,
        normalization: input.normalization,
        bands: toJson(input.bands),
        rules: {
          createMany: {
            data: input.rules.map((r, position) => ({
              criterionKey: r.criterionKey,
              params: toJson(r.params),
              points: r.points,
              active: r.active,
              position,
              description: r.description,
            })),
          },
        },
      },
    });
    await ctx.audit({
      action: 'scoring.draft_update',
      entityType: 'scoring_model',
      entityId: draft.id,
      metadata: { version: draft.version, rules: input.rules.length },
    });
    return describeModel(await requireModel(ctx, draft.id));
  },
});

/** Descarta o rascunho (nunca foi usado para pontuar leads). */
export const discardScoringDraft = defineUseCase({
  name: 'scoring.discardDraft',
  access: 'settings.manage',
  input: scoringModelIdInput,
  async run(ctx, input) {
    const draft = await requireDraft(ctx, input.modelId);
    await ctx.tx.scoringModel.delete({ where: { id: draft.id } });
    await ctx.audit({
      action: 'scoring.draft_discard',
      entityType: 'scoring_model',
      entityId: draft.id,
      metadata: { version: draft.version },
    });
    return { discarded: true };
  },
});

/** Leads por faixa, para a simulação. */
const emptyDistribution = (): Record<ScoreBand, number> => ({
  COLD: 0,
  WARM: 0,
  HOT: 0,
  PRIORITY: 0,
});

/**
 * Simula o modelo sobre os leads ativos antes de ativar (F4-07): quantos
 * ficariam em cada faixa, comparado ao modelo ativo, e quantos mudariam.
 */
export const simulateScoringModel = defineUseCase({
  name: 'scoring.simulate',
  access: 'settings.manage',
  input: scoringModelIdInput,
  async run(ctx, input) {
    const candidate = toModelInput(await requireModel(ctx, input.modelId));
    const active = await loadActiveModel(ctx.tx);
    const current = emptyDistribution();
    const simulated = emptyDistribution();
    let total = 0;
    let bandChanges = 0;
    let scoreSum = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await ctx.tx.lead.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        take: 1_000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      if (batch.length === 0) break;
      cursor = batch.at(-1)!.id;
      for (const lead of await loadScoreFacts(
        ctx.tx,
        batch.map((b) => b.id),
      )) {
        const next = computeScore(candidate, lead.facts, ctx.now);
        const now = active ? computeScore(active, lead.facts, ctx.now) : null;
        total += 1;
        scoreSum += next.score;
        simulated[next.band] += 1;
        if (now) current[now.band] += 1;
        if (!now || now.band !== next.band) bandChanges += 1;
      }
    }
    return {
      total,
      bands: SCORE_BANDS.map((band) => ({
        band,
        label: SCORE_BAND_LABELS[band],
        current: current[band],
        simulated: simulated[band],
      })),
      bandChanges,
      averageScore: total ? Math.round(scoreSum / total) : 0,
    };
  },
});

/**
 * Ativa o rascunho (F4-07): o ativo vira arquivado e a base inteira é
 * recalculada no worker (`score.recompute-all`).
 */
export const activateScoringModel = defineUseCase({
  name: 'scoring.activate',
  access: 'settings.manage',
  input: scoringModelIdInput,
  async run(ctx, input) {
    const draft = await requireDraft(ctx, input.modelId);
    if (draft.rules.filter((r) => r.active).length === 0) {
      throw new BusinessRuleError('Ative ao menos um critério antes de publicar o modelo.');
    }
    const previous = await ctx.tx.scoringModel.findFirst({ where: { status: 'ACTIVE' } });
    if (previous) {
      await ctx.tx.scoringModel.update({
        where: { id: previous.id },
        data: { status: 'ARCHIVED' },
      });
    }
    await ctx.tx.scoringModel.update({
      where: { id: draft.id },
      data: {
        status: 'ACTIVE',
        activatedAt: ctx.now,
        activatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.scoreRecomputeAll.name,
      { trigger: 'model.activated' },
      { tx: ctx.tx },
    );
    await ctx.audit({
      action: 'scoring.activate',
      entityType: 'scoring_model',
      entityId: draft.id,
      changes: { activeVersion: [previous?.version ?? null, draft.version] },
    });
    return { modelId: draft.id, version: draft.version };
  },
});
