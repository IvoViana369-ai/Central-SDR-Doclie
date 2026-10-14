import type { CoreDeps } from '../../../shared/use-case';
import { loadActiveModel, recomputeLeadScores, type RecomputeSummary } from '../infra/recompute';

/** Leads por transação nos recálculos em massa. */
const CHUNK = 500;
const TIMEOUT_MS = 120_000;

/** Job `score.recompute-lead`: recalcula leads específicos (ações em massa). */
export async function runScoreRecomputeLeads(
  deps: CoreDeps,
  job: { leadIds: string[]; trigger?: string },
): Promise<RecomputeSummary> {
  const ids = [...new Set(job.leadIds)];
  const total: RecomputeSummary = { computed: 0, changed: 0 };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const result = await deps.db.$transaction(
      (tx) =>
        recomputeLeadScores(tx, ids.slice(i, i + CHUNK), job.trigger ?? 'bulk', deps.clock.now()),
      { timeout: TIMEOUT_MS },
    );
    total.computed += result.computed;
    total.changed += result.changed;
  }
  return total;
}

/**
 * Job `score.recompute-all`: recalcula a base inteira (ativação de modelo) ou
 * os leads de uma cidade (lista de prioridades), em lotes por transação.
 * Também calcula quem ainda não tem score (leads de antes da Fase 4).
 */
export async function runScoreRecomputeAll(
  deps: CoreDeps,
  job: { trigger?: string; municipalityCode?: number | null },
): Promise<RecomputeSummary> {
  const model = await deps.db.$transaction((tx) => loadActiveModel(tx));
  const total: RecomputeSummary = { computed: 0, changed: 0 };
  if (!model) return total;
  let cursor: string | undefined;
  for (;;) {
    const batch = await deps.db.lead.findMany({
      where: {
        status: { in: ['ACTIVE', 'ARCHIVED'] },
        ...(job.municipalityCode ? { municipalityCode: job.municipalityCode } : {}),
      },
      orderBy: { id: 'asc' },
      take: CHUNK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (batch.length === 0) break;
    cursor = batch.at(-1)!.id;
    const result = await deps.db.$transaction(
      (tx) =>
        recomputeLeadScores(
          tx,
          batch.map((b) => b.id),
          job.trigger ?? 'recompute',
          deps.clock.now(),
          model,
        ),
      { timeout: TIMEOUT_MS },
    );
    total.computed += result.computed;
    total.changed += result.changed;
  }
  deps.logger.info({ ...total, trigger: job.trigger }, 'Recálculo de score concluído');
  return total;
}

/** Há leads sem score (ex.: logo após implantar a Fase 4)? */
export async function hasUnscoredLeads(deps: CoreDeps): Promise<boolean> {
  const lead = await deps.db.lead.findFirst({
    where: { status: { in: ['ACTIVE', 'ARCHIVED'] }, scoreComputedAt: null },
    select: { id: true },
  });
  return lead !== null;
}
