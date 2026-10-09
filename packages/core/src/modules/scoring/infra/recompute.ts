import type { DbTransaction } from '@docline/db';
import { toJson } from '../../../shared/use-case';
import type { ScoreFacts } from '../domain/criteria';
import { computeScore, type BandRange, type ScoringModelInput } from '../domain/score';

export type LoadedModel = ScoringModelInput & { id: string; version: number; name: string };

/** Modelo ativo com as regras (nulo antes do seed). */
export async function loadActiveModel(tx: DbTransaction): Promise<LoadedModel | null> {
  const model = await tx.scoringModel.findFirst({
    where: { status: 'ACTIVE' },
    include: { rules: { orderBy: { position: 'asc' } } },
  });
  return model ? toModelInput(model) : null;
}

export function toModelInput(model: {
  id: string;
  version: number;
  name: string;
  normalization: ScoringModelInput['normalization'];
  bands: unknown;
  rules: { id: string; criterionKey: string; params: unknown; points: number; active: boolean }[];
}): LoadedModel {
  return {
    id: model.id,
    version: model.version,
    name: model.name,
    normalization: model.normalization,
    bands: model.bands as BandRange[],
    rules: model.rules.map((r) => ({
      id: r.id,
      criterionKey: r.criterionKey,
      params: r.params,
      points: r.points,
      active: r.active,
    })),
  };
}

const factsSelect = {
  id: true,
  status: true,
  hasWhatsapp: true,
  hasInstagram: true,
  hasWebsite: true,
  hasEmail: true,
  hasPhone: true,
  cnpj: true,
  stateUf: true,
  municipalityCode: true,
  leadType: true,
  score: true,
  scoreBand: true,
  scoreModelId: true,
  scoreComputedAt: true,
  tags: { select: { tagId: true } },
} as const;

export interface LeadScoreState {
  id: string;
  status: string;
  facts: ScoreFacts;
  current: {
    score: number | null;
    band: string | null;
    modelId: string | null;
    computedAt: Date | null;
  };
}

/** Fatos do score para um lote de leads (poucas consultas por lote). */
export async function loadScoreFacts(
  tx: DbTransaction,
  leadIds: string[],
): Promise<LeadScoreState[]> {
  if (leadIds.length === 0) return [];
  const leads = await tx.lead.findMany({ where: { id: { in: leadIds } }, select: factsSelect });
  const codes = [
    ...new Set(leads.flatMap((l) => (l.municipalityCode ? [l.municipalityCode] : []))),
  ];
  const priority = codes.length
    ? new Set(
        (
          await tx.priorityCity.findMany({
            where: { municipalityCode: { in: codes }, active: true },
            select: { municipalityCode: true },
          })
        ).map((p) => p.municipalityCode),
      )
    : new Set<number>();
  return leads.map((l) => ({
    id: l.id,
    status: l.status,
    facts: {
      hasWhatsapp: l.hasWhatsapp,
      hasInstagram: l.hasInstagram,
      hasWebsite: l.hasWebsite,
      hasEmail: l.hasEmail,
      hasPhone: l.hasPhone,
      hasCnpj: l.cnpj !== null,
      stateUf: l.stateUf,
      inPriorityCity: l.municipalityCode !== null && priority.has(l.municipalityCode),
      leadType: l.leadType,
      tagIds: l.tags.map((t) => t.tagId),
      // Respostas e interesse chegam com as mensagens da Fase 5; atividade do
      // Instagram, na Fase 8; avaliações do Google, só após a validação jurídica.
      repliedBefore: false,
      showedInterest: false,
      instagramLastPostAt: null,
      googleReviewsCount: null,
    },
    current: {
      score: l.score,
      band: l.scoreBand,
      modelId: l.scoreModelId,
      computedAt: l.scoreComputedAt,
    },
  }));
}

export interface RecomputeSummary {
  computed: number;
  changed: number;
}

/**
 * Recalcula o score de leads ativos ou arquivados com o modelo ativo, na
 * transação de quem chama. Grava só o que mudou: cache no lead e, quando o
 * score ou a faixa mudam, histórico e (exceto no primeiro cálculo) o evento
 * `score.changed` na timeline.
 */
export async function recomputeLeadScores(
  tx: DbTransaction,
  leadIds: string[],
  trigger: string,
  now: Date,
  model?: LoadedModel | null,
): Promise<RecomputeSummary> {
  const active = model === undefined ? await loadActiveModel(tx) : model;
  if (!active || leadIds.length === 0) return { computed: 0, changed: 0 };
  const states = await loadScoreFacts(tx, leadIds);
  let computed = 0;
  let changed = 0;
  for (const lead of states) {
    if (lead.status !== 'ACTIVE' && lead.status !== 'ARCHIVED') continue;
    computed += 1;
    const result = computeScore(active, lead.facts, now);
    const scoreChanged = result.score !== lead.current.score || result.band !== lead.current.band;
    if (!scoreChanged && lead.current.modelId === active.id && lead.current.computedAt) continue;
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        score: result.score,
        scoreBand: result.band,
        scoreModelId: active.id,
        scoreComputedAt: now,
      },
    });
    if (!scoreChanged) continue;
    changed += 1;
    await tx.leadScoreHistory.create({
      data: {
        leadId: lead.id,
        modelId: active.id,
        score: result.score,
        band: result.band,
        previousScore: lead.current.score,
        previousBand: (lead.current.band as typeof result.band | null) ?? null,
        breakdown: toJson(result.breakdown),
        trigger,
        computedAt: now,
      },
    });
    // O primeiro cálculo (no cadastro ou na implantação) vai só para o histórico
    // do score; a timeline mostra mudanças.
    if (lead.current.score === null) continue;
    await tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'score.changed',
        occurredAt: now,
        actorType: 'AUTOMATION',
        payload: toJson({
          from: { score: lead.current.score, band: lead.current.band },
          to: { score: result.score, band: result.band },
          modelVersion: active.version,
          trigger,
        }),
      },
    });
  }
  return { computed, changed };
}
