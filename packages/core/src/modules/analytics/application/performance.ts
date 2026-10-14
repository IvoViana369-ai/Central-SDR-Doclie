import { toCsv, type CsvValue } from '../../../shared/csv';
import { NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { compareVariants, type AbComparison } from '../../campaigns';
import {
  channelReportInput,
  conversionReportInput,
  exportPerformanceInput,
  monthlyReportInput,
  PERFORMANCE_REPORT_LABELS,
  teamPeriodInput,
} from '../contracts/schemas';
import { rateStat, type RateStat } from '../domain/confidence';
import {
  ANALYTICS_CHANNEL_LABELS,
  CONVERSION_DIMENSION_LABELS,
  CONVERSION_NULL_LABELS,
  type ConversionDimension,
} from '../domain/dimensions';
import { ratio } from '../domain/metrics';
import { monthLabel, resolveMonths } from '../domain/months';
import { resolvePeriod, todayIn } from '../domain/period';
import {
  activePortfolio,
  cohortBy,
  rollupSums,
  type CohortRow,
  type RollupSums,
} from '../infra/facts';
import { readRollupStatus } from './rollup';

/**
 * Relatórios da Fase 11 (F11-02/F11-03; docs/SDR-FLOW.md §11): conversão por
 * recorte, desempenho por SDR, evolução mensal e canais. Leem os rollups
 * (`analytics.rollup`), não a base ao vivo; toda taxa vem com intervalo de
 * confiança e, abaixo de 20 na base, com o aviso de amostra insuficiente.
 * ADMIN e GESTOR (`report.read`).
 */

const emptyCohort: Omit<CohortRow, 'key' | 'isTotal'> = {
  firstContacts: 0,
  replied: 0,
  interested: 0,
  opportunities: 0,
  won: 0,
  partners: 0,
  customers: 0,
  optedOut: 0,
};

const emptySums: Omit<RollupSums, 'key'> = {
  newLeads: 0,
  firstContacts: 0,
  messagesOut: 0,
  contactsLogged: 0,
  messagesIn: 0,
  leadsReplied: 0,
  interested: 0,
  opportunities: 0,
  conversions: 0,
  optOuts: 0,
};

export interface CohortRates {
  response: RateStat;
  interest: RateStat;
  opportunity: RateStat;
  conversion: RateStat;
}

type Reference = Record<keyof CohortRates, number | null>;

const referenceOf = (total: Omit<CohortRow, 'key' | 'isTotal'>): Reference => ({
  response: ratio(total.replied, total.firstContacts),
  interest: ratio(total.interested, total.firstContacts),
  opportunity: ratio(total.opportunities, total.firstContacts),
  conversion: ratio(total.won, total.firstContacts),
});

/** Taxas da coorte; com referência, cada uma diz se está acima, abaixo ou dentro da média. */
function cohortRates(row: Omit<CohortRow, 'key' | 'isTotal'>, ref: Reference | null): CohortRates {
  return {
    response: rateStat(row.replied, row.firstContacts, ref?.response ?? null),
    interest: rateStat(row.interested, row.firstContacts, ref?.interest ?? null),
    opportunity: rateStat(row.opportunities, row.firstContacts, ref?.opportunity ?? null),
    conversion: rateStat(row.won, row.firstContacts, ref?.conversion ?? null),
  };
}

const countsOf = ({ key: _key, isTotal: _total, ...counts }: CohortRow) => counts;
const sumsOf = ({ key: _key, ...sums }: RollupSums) => sums;

async function resolvePerson(ctx: UseCaseContext, userId: string | null | undefined) {
  if (!userId) return null;
  const person = await ctx.tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!person) throw new NotFoundError('Pessoa não encontrada.');
  return person;
}

async function freshness(ctx: UseCaseContext) {
  const status = await readRollupStatus(ctx);
  return { refreshedAt: status?.refreshedAt ?? null };
}

/** Nome de cada chave do recorte (cidade, segmento, pessoa, campanha…). */
async function dimensionLabels(
  ctx: UseCaseContext,
  dimension: ConversionDimension,
  keys: string[],
): Promise<Map<string, string>> {
  const ids = keys.filter(Boolean);
  const pairs = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  const byId = { where: { id: { in: ids } }, select: { id: true, name: true } } as const;
  switch (dimension) {
    case 'city': {
      const rows = await ctx.tx.municipality.findMany({
        where: { ibgeCode: { in: ids.map(Number).filter(Number.isFinite) } },
        select: { ibgeCode: true, name: true, uf: true },
      });
      return new Map(rows.map((r) => [String(r.ibgeCode), `${r.name}/${r.uf}`]));
    }
    case 'state':
      return new Map(ids.map((uf) => [uf, uf]));
    case 'channel':
      return new Map(ids.map((c) => [c, ANALYTICS_CHANNEL_LABELS[c] ?? c]));
    case 'segment':
      return pairs(await ctx.tx.segment.findMany(byId));
    case 'source':
      return pairs(await ctx.tx.leadSource.findMany(byId));
    case 'campaign':
      return pairs(await ctx.tx.campaign.findMany(byId));
    case 'approach':
      return pairs(await ctx.tx.approach.findMany(byId));
    case 'owner':
    case 'firstContactUser':
      return pairs(await ctx.tx.user.findMany(byId));
  }
}

// --- Conversão por recorte ---------------------------------------------------

async function conversion(
  ctx: UseCaseContext,
  input: {
    from?: string | null;
    to?: string | null;
    userId?: string | null;
    dimension: ConversionDimension;
    limit: number;
  },
) {
  const period = resolvePeriod(input, ctx.now);
  const person = await resolvePerson(ctx, input.userId);
  const rows = await cohortBy(
    ctx.tx,
    { start: period.start, end: period.end, userId: person?.id ?? null },
    { dimension: input.dimension },
  );
  const total = countsOf(
    rows.find((r) => r.isTotal) ?? { key: null, isTotal: true, ...emptyCohort },
  );
  const ref = referenceOf(total);
  const groups = rows.filter((r) => !r.isTotal);
  const labels = await dimensionLabels(
    ctx,
    input.dimension,
    groups.map((r) => r.key ?? ''),
  );
  const items = groups
    .map((r) => ({
      key: r.key,
      label: r.key ? (labels.get(r.key) ?? 'Removido') : CONVERSION_NULL_LABELS[input.dimension],
      ...countsOf(r),
      rates: cohortRates(countsOf(r), ref),
    }))
    .sort((a, b) => b.firstContacts - a.firstContacts || a.label.localeCompare(b.label, 'pt-BR'));
  return {
    scope: { from: period.from, to: period.to, days: period.days.length, person },
    dimension: input.dimension,
    dimensionLabel: CONVERSION_DIMENSION_LABELS[input.dimension],
    total: { ...total, rates: cohortRates(total, null) },
    rows: items.slice(0, input.limit),
    truncated: items.length > input.limit,
    freshness: await freshness(ctx),
  };
}

export const getConversionReport = defineUseCase({
  name: 'analytics.conversion',
  access: 'report.read',
  input: conversionReportInput,
  run: conversion,
});

export type ConversionReport = Awaited<ReturnType<typeof conversion>>;

// --- Desempenho por SDR ------------------------------------------------------

async function sdrPerformance(
  ctx: UseCaseContext,
  input: { from?: string | null; to?: string | null },
) {
  const period = resolvePeriod(input, ctx.now);
  const cohort = await cohortBy(
    ctx.tx,
    { start: period.start, end: period.end, userId: null },
    { dimension: 'firstContactUser' },
  );
  const sums = await rollupSums(ctx.tx, period, { dimension: 'SDR', userId: null }, false);
  const teamSums = await rollupSums(ctx.tx, period, { dimension: 'GLOBAL' }, false);
  const portfolio = await activePortfolio(ctx.tx);
  const total = countsOf(
    cohort.find((r) => r.isTotal) ?? { key: null, isTotal: true, ...emptyCohort },
  );
  const ref = referenceOf(total);
  const cohortByKey = new Map(cohort.filter((r) => !r.isTotal && r.key).map((r) => [r.key!, r]));
  const sumsBy = new Map(sums.map((s) => [s.key, s]));
  const ids = [...new Set([...cohortByKey.keys(), ...sumsBy.keys()])];
  const users = await ctx.tx.user.findMany({
    where: { OR: [{ role: 'SDR', status: 'ACTIVE' }, { id: { in: ids } }] },
    select: { id: true, name: true, role: true, status: true },
    orderBy: { name: 'asc' },
  });
  const rows = users
    .map((user) => {
      const c = cohortByKey.get(user.id);
      const counts = c ? countsOf(c) : emptyCohort;
      const activity = sumsBy.get(user.id);
      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        active: user.status === 'ACTIVE',
        portfolio: portfolio.get(user.id) ?? 0,
        activity: activity ? sumsOf(activity) : emptySums,
        cohort: counts,
        rates: cohortRates(counts, ref),
      };
    })
    .sort(
      (a, b) =>
        b.cohort.firstContacts - a.cohort.firstContacts ||
        b.activity.messagesOut +
          b.activity.contactsLogged -
          (a.activity.messagesOut + a.activity.contactsLogged) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
  return {
    scope: { from: period.from, to: period.to, days: period.days.length },
    team: {
      cohort: total,
      rates: cohortRates(total, null),
      activity: teamSums[0] ? sumsOf(teamSums[0]) : emptySums,
    },
    rows,
    freshness: await freshness(ctx),
  };
}

export const getSdrPerformance = defineUseCase({
  name: 'analytics.sdrPerformance',
  access: 'report.read',
  input: teamPeriodInput,
  run: sdrPerformance,
});

export type SdrPerformanceReport = Awaited<ReturnType<typeof sdrPerformance>>;

// --- Evolução mensal ---------------------------------------------------------

function lastDayOf(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

async function monthly(
  ctx: UseCaseContext,
  input: { fromMonth?: string | null; toMonth?: string | null; userId?: string | null },
) {
  const range = resolveMonths({ from: input.fromMonth, to: input.toMonth }, ctx.now);
  const person = await resolvePerson(ctx, input.userId);
  const sums = await rollupSums(
    ctx.tx,
    { from: `${range.from}-01`, to: lastDayOf(range.to) },
    person ? { dimension: 'SDR', userId: person.id } : { dimension: 'GLOBAL' },
    true,
  );
  const cohort = await cohortBy(
    ctx.tx,
    { start: range.start, end: range.end, userId: person?.id ?? null },
    { monthTimeZone: range.timeZone },
  );
  const total = countsOf(
    cohort.find((r) => r.isTotal) ?? { key: null, isTotal: true, ...emptyCohort },
  );
  const ref = referenceOf(total);
  const sumsBy = new Map(sums.map((s) => [s.key, sumsOf(s)]));
  const cohortByKey = new Map(cohort.filter((r) => !r.isTotal).map((r) => [r.key, countsOf(r)]));
  const today = todayIn(ctx.now, range.timeZone);
  const current = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const months = range.months.map((month) => {
    const counts = cohortByKey.get(month) ?? emptyCohort;
    return {
      month,
      label: monthLabel(month),
      /** Mês corrente: ainda em andamento. */
      partial: month === current,
      activity: sumsBy.get(month) ?? emptySums,
      cohort: counts,
      rates: cohortRates(counts, ref),
    };
  });
  const activityTotal = months.reduce(
    (acc, m) => {
      for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += m.activity[key];
      return acc;
    },
    { ...emptySums },
  );
  return {
    scope: { from: range.from, to: range.to, months: range.months.length, person },
    months,
    total: { activity: activityTotal, cohort: total, rates: cohortRates(total, null) },
    freshness: await freshness(ctx),
  };
}

export const getMonthlyEvolution = defineUseCase({
  name: 'analytics.monthly',
  access: 'report.read',
  input: monthlyReportInput,
  run: monthly,
});

export type MonthlyReport = Awaited<ReturnType<typeof monthly>>;

// --- Canais (WhatsApp × Instagram) -------------------------------------------

/** Canais sempre mostrados, mesmo sem movimento (a comparação principal). */
const MAIN_CHANNELS = ['WHATSAPP', 'INSTAGRAM'] as const;

async function channels(ctx: UseCaseContext, input: { from?: string | null; to?: string | null }) {
  const period = resolvePeriod(input, ctx.now);
  const cohort = await cohortBy(
    ctx.tx,
    { start: period.start, end: period.end, userId: null },
    { dimension: 'channel' },
  );
  const sums = await rollupSums(ctx.tx, period, { dimension: 'CHANNEL' }, false);
  const total = countsOf(
    cohort.find((r) => r.isTotal) ?? { key: null, isTotal: true, ...emptyCohort },
  );
  const ref = referenceOf(total);
  const cohortByKey = new Map(cohort.filter((r) => !r.isTotal).map((r) => [r.key, countsOf(r)]));
  const sumsBy = new Map(sums.map((s) => [s.key, sumsOf(s)]));
  const keys = [
    ...new Set([...MAIN_CHANNELS, ...sumsBy.keys(), ...[...cohortByKey.keys()].filter(Boolean)]),
  ] as string[];
  const rows = keys
    .map((channel) => {
      const counts = cohortByKey.get(channel) ?? emptyCohort;
      return {
        channel,
        label: ANALYTICS_CHANNEL_LABELS[channel] ?? channel,
        activity: sumsBy.get(channel) ?? emptySums,
        cohort: counts,
        rates: cohortRates(counts, ref),
      };
    })
    .sort((a, b) => {
      const main = (c: string) => (MAIN_CHANNELS as readonly string[]).indexOf(c);
      const ma = main(a.channel);
      const mb = main(b.channel);
      if (ma !== -1 || mb !== -1) return (ma === -1 ? 99 : ma) - (mb === -1 ? 99 : mb);
      return b.cohort.firstContacts - a.cohort.firstContacts;
    });
  const unknown = cohortByKey.get(null);
  const sample = (channel: string, pick: (c: typeof emptyCohort) => number) => {
    const counts = cohortByKey.get(channel) ?? emptyCohort;
    return {
      id: channel,
      label: ANALYTICS_CHANNEL_LABELS[channel]!,
      successes: pick(counts),
      trials: counts.firstContacts,
    };
  };
  // WhatsApp comparado ao Instagram (referência), como no A/B das campanhas.
  const compare = (pick: (c: typeof emptyCohort) => number): AbComparison | null =>
    compareVariants([sample('WHATSAPP', pick), sample('INSTAGRAM', pick)])[0] ?? null;
  return {
    scope: { from: period.from, to: period.to, days: period.days.length },
    rows,
    /** 1ºs contatos sem canal identificado (ex.: só ligação não atendida). */
    unidentified: unknown?.firstContacts ?? 0,
    total: { cohort: total, rates: cohortRates(total, null) },
    whatsappVsInstagram: {
      response: compare((c) => c.replied),
      interest: compare((c) => c.interested),
    },
    freshness: await freshness(ctx),
  };
}

export const getChannelReport = defineUseCase({
  name: 'analytics.channels',
  access: 'report.read',
  input: channelReportInput,
  run: channels,
});

export type ChannelReport = Awaited<ReturnType<typeof channels>>;

// --- Exportação --------------------------------------------------------------

const pct = (value: number | null) =>
  value === null ? null : (value * 100).toFixed(1).replace('.', ',');
const interval = (stat: RateStat) =>
  stat.interval ? `${pct(stat.interval.low)}–${pct(stat.interval.high)}` : null;
const flag = (stat: RateStat) => (stat.smallSample ? 'sim' : 'não');

const RATE_HEADER = [
  'Primeiros contatos (coorte)',
  'Responderam',
  'Taxa de resposta (%)',
  'IC 95% da resposta (%)',
  'Interessados',
  'Oportunidades',
  'Conversões',
  'Taxa de conversão (%)',
  'IC 95% da conversão (%)',
  'Amostra insuficiente',
];

const rateCells = (c: Omit<CohortRow, 'key' | 'isTotal'>, r: CohortRates): CsvValue[] => [
  c.firstContacts,
  c.replied,
  pct(r.response.rate),
  interval(r.response),
  c.interested,
  c.opportunities,
  c.won,
  pct(r.conversion.rate),
  interval(r.conversion),
  flag(r.response),
];

const ACTIVITY_HEADER = [
  'Mensagens enviadas',
  'Contatos registrados',
  'Mensagens recebidas',
  'Oportunidades',
  'Conversões',
  'Opt-outs',
];

const activityCells = (a: Omit<RollupSums, 'key'>): CsvValue[] => [
  a.messagesOut,
  a.contactsLogged,
  a.messagesIn,
  a.opportunities,
  a.conversions,
  a.optOuts,
];

/** Exportação CSV dos relatórios da Fase 11 (ADMIN e GESTOR), auditada como `report.export`. */
export const exportPerformanceReport = defineUseCase({
  name: 'analytics.exportPerformance',
  access: 'report.read',
  input: exportPerformanceInput,
  async run(ctx, input) {
    let csv: string;
    let rows: number;
    let span: string;
    switch (input.report) {
      case 'conversion': {
        const data = await conversion(ctx, { ...input, limit: 1000 });
        csv = toCsv(
          [data.dimensionLabel, ...RATE_HEADER],
          data.rows.map((r) => [r.label, ...rateCells(r, r.rates)]),
        );
        rows = data.rows.length;
        span = `${input.dimension}-${data.scope.from}_${data.scope.to}`;
        break;
      }
      case 'sdrPerformance': {
        const data = await sdrPerformance(ctx, input);
        csv = toCsv(
          ['Pessoa', 'Carteira ativa', ...ACTIVITY_HEADER, ...RATE_HEADER],
          data.rows.map((r) => [
            r.name,
            r.portfolio,
            ...activityCells(r.activity),
            ...rateCells(r.cohort, r.rates),
          ]),
        );
        rows = data.rows.length;
        span = `${data.scope.from}_${data.scope.to}`;
        break;
      }
      case 'monthly': {
        const data = await monthly(ctx, input);
        csv = toCsv(
          ['Mês', 'Em andamento', 'Novos leads', ...ACTIVITY_HEADER, ...RATE_HEADER],
          data.months.map((m) => [
            m.month,
            m.partial ? 'sim' : 'não',
            m.activity.newLeads,
            ...activityCells(m.activity),
            ...rateCells(m.cohort, m.rates),
          ]),
        );
        rows = data.months.length;
        span = `${data.scope.from}_${data.scope.to}`;
        break;
      }
      case 'channels': {
        const data = await channels(ctx, input);
        csv = toCsv(
          ['Canal', ...ACTIVITY_HEADER, ...RATE_HEADER],
          data.rows.map((r) => [
            r.label,
            ...activityCells(r.activity),
            ...rateCells(r.cohort, r.rates),
          ]),
        );
        rows = data.rows.length;
        span = `${data.scope.from}_${data.scope.to}`;
        break;
      }
    }
    await ctx.audit({
      action: 'report.export',
      entityType: 'report',
      entityId: null,
      metadata: { ...input, rows },
    });
    return {
      filename: `relatorio-${input.report}-${span}.csv`,
      title: PERFORMANCE_REPORT_LABELS[input.report],
      csv,
      rows,
    };
  },
});
