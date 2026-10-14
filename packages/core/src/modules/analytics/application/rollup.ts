import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  isoDate,
  localParts,
  type LocalDate,
} from '../../../shared/calendar';
import { defineUseCase, type CoreDeps, type UseCaseContext } from '../../../shared/use-case';
import { rollupRequestInput } from '../contracts/schemas';
import { MAX_MONTHS } from '../domain/months';
import { parseIsoDay, resolvePeriod, todayIn } from '../domain/period';
import {
  computeDailyMetrics,
  firstLeadDay,
  lastComputedDay,
  refreshLeadFacts,
} from '../infra/rollups';

/**
 * Job `analytics.rollup` (F11-01): atualiza os fatos por lead e recalcula
 * `daily_metrics`. De hora em hora refaz hoje e ontem; às 03h, os últimos 7
 * dias (contatos registrados com data retroativa, respostas classificadas
 * depois). Se o worker ficou parado, começa do último dia calculado; na
 * primeira execução, preenche desde o lead mais antigo (até 36 meses).
 */

export const ANALYTICS_ROLLUP_KEY = 'analytics.rollup';

const RECENT_DAYS = 2;
const NIGHTLY_DAYS = 7;
const NIGHTLY_HOUR = 3;
/** Dias por transação. */
const CHUNK_DAYS = 31;
const BACKFILL_MAX_DAYS = MAX_MONTHS * 31;
const TIMEOUT_MS = 120_000;

const jobInput = z.object({ from: z.string().optional(), to: z.string().optional() });

export interface RollupStatus {
  refreshedAt: string;
  from: string;
  to: string;
  durationMs: number;
}

const before = (a: LocalDate, b: LocalDate) => isoDate(a) < isoDate(b);

async function defaultRange(deps: CoreDeps, now: Date, timeZone: string) {
  const today = todayIn(now, timeZone);
  const nightly = Math.floor(localParts(now, timeZone).minutes / 60) === NIGHTLY_HOUR;
  let from = addDays(today, -((nightly ? NIGHTLY_DAYS : RECENT_DAYS) - 1));
  const last = await lastComputedDay(deps.db);
  const resumeFrom = parseIsoDay(last ?? (await firstLeadDay(deps.db, timeZone)) ?? '');
  if (resumeFrom && before(resumeFrom, from)) {
    const floor = addDays(today, -(BACKFILL_MAX_DAYS - 1));
    from = before(resumeFrom, floor) ? floor : resumeFrom;
  }
  return { from, to: today };
}

export async function runAnalyticsRollup(deps: CoreDeps, data: unknown = {}) {
  const input = jobInput.parse(data ?? {});
  const now = deps.clock.now();
  const timeZone = DEFAULT_TIME_ZONE;
  const started = Date.now();
  let range: { from: LocalDate; to: LocalDate };
  if (input.from || input.to) {
    const period = resolvePeriod(input, now, timeZone);
    range = { from: parseIsoDay(period.from)!, to: parseIsoDay(period.to)! };
  } else {
    range = await defaultRange(deps, now, timeZone);
  }

  await refreshLeadFacts(deps.db);
  let days = 0;
  let rows = 0;
  for (let start = range.from; !before(range.to, start); start = addDays(start, CHUNK_DAYS)) {
    const chunkEnd = addDays(start, CHUNK_DAYS - 1);
    const end = before(range.to, chunkEnd) ? range.to : chunkEnd;
    const period = resolvePeriod({ from: isoDate(start), to: isoDate(end) }, now, timeZone);
    rows += await deps.db.$transaction((tx) => computeDailyMetrics(tx, period, now), {
      timeout: TIMEOUT_MS,
    });
    days += period.days.length;
  }

  const status: RollupStatus = {
    refreshedAt: now.toISOString(),
    from: isoDate(range.from),
    to: isoDate(range.to),
    durationMs: Date.now() - started,
  };
  await deps.db.appSetting.upsert({
    where: { key: ANALYTICS_ROLLUP_KEY },
    create: { key: ANALYTICS_ROLLUP_KEY, value: { ...status } },
    update: { value: { ...status } },
  });
  deps.logger.info({ ...status, days, rows }, 'Indicadores recalculados');
  return { ...status, days, rows };
}

/** Quando os rollups foram atualizados pela última vez (nulo: nunca). */
export async function readRollupStatus(ctx: UseCaseContext): Promise<RollupStatus | null> {
  const row = await ctx.tx.appSetting.findUnique({ where: { key: ANALYTICS_ROLLUP_KEY } });
  const value = row?.value as Partial<RollupStatus> | undefined;
  return value?.refreshedAt ? (value as RollupStatus) : null;
}

/**
 * Pede o recálculo de um período (ADMIN e GESTOR), por exemplo depois de
 * importar histórico ou registrar contatos antigos. Roda no worker.
 */
export const requestAnalyticsRollup = defineUseCase({
  name: 'analytics.requestRollup',
  access: 'report.read',
  input: rollupRequestInput,
  async run(ctx, input) {
    const period = resolvePeriod(input, ctx.now);
    const jobId = await ctx.deps.jobs.enqueue(
      JOBS.analyticsRollup.name,
      { from: period.from, to: period.to },
      { tx: ctx.tx, singletonKey: `analytics.rollup:${period.from}:${period.to}` },
    );
    await ctx.audit({
      action: 'analytics.rollup_requested',
      entityType: 'report',
      entityId: null,
      metadata: { from: period.from, to: period.to },
    });
    return { from: period.from, to: period.to, queued: jobId !== null };
  },
});
