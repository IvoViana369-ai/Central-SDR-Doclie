import { toCsv, type CsvValue } from '../../../shared/csv';
import { NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { roleHasPermission } from '../../identity';
import {
  analyticsFilterInput,
  breakdownInput,
  exportReportInput,
  REPORT_LABELS,
  type BreakdownDimension,
} from '../contracts/schemas';
import { isSmallSample, ratio } from '../domain/metrics';
import { resolvePeriod } from '../domain/period';
import {
  contactMetrics,
  dailySeries,
  interestedInPeriod,
  leadMetrics,
  medianHoursToFirstContact,
  optOutsInPeriod,
  outcomeMetrics,
  stageCounts,
  type AnalyticsFilter,
  type LeadDimension,
  type LeadMetricsRow,
} from '../infra/queries';

/**
 * Dashboard e relatórios básicos (M16; docs/SDR-FLOW.md §11). Quem tem
 * `report.read` (ADMIN e GESTOR) vê a equipe e pode filtrar por pessoa; os
 * demais veem só os próprios números.
 */

interface FilterInput {
  from?: string | null;
  to?: string | null;
  userId?: string | null;
}

const canSeeTeam = (ctx: UseCaseContext) =>
  ctx.actor.kind !== 'user' || roleHasPermission(ctx.actor.role, 'report.read');

async function resolveFilter(ctx: UseCaseContext, input: FilterInput) {
  const team = canSeeTeam(ctx);
  const userId = team ? (input.userId ?? null) : ctx.actor.kind === 'user' ? ctx.actor.id : null;
  const person = userId
    ? await ctx.tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    : null;
  if (userId && !person) throw new NotFoundError('Pessoa não encontrada.');
  const period = resolvePeriod(input, ctx.now);
  const filter: AnalyticsFilter = { period, userId };
  return {
    filter,
    scope: { canSeeTeam: team, person, from: period.from, to: period.to, days: period.days.length },
  };
}

const emptyLeadRow: LeadMetricsRow = {
  key: null,
  active: 0,
  newLeads: 0,
  firstContacts: 0,
  responded: 0,
  interestedCohort: 0,
  opportunitiesCohort: 0,
  wonCohort: 0,
};

/** Indicadores do período; `leadRow` vem pronto quando o dashboard já calculou tudo. */
async function overview(ctx: UseCaseContext, filter: AnalyticsFilter, leadRow?: LeadMetricsRow) {
  const [leads, median, [contacts], [outcomes], interested, optOuts] = await Promise.all([
    leadRow
      ? Promise.resolve(leadRow)
      : leadMetrics(ctx.tx, filter, ['none']).then((m) => m.get('none')![0] ?? emptyLeadRow),
    medianHoursToFirstContact(ctx.tx, filter),
    contactMetrics(ctx.tx, filter, false),
    outcomeMetrics(ctx.tx, filter, false),
    interestedInPeriod(ctx.tx, filter),
    optOutsInPeriod(ctx.tx, filter),
  ]);
  return {
    kpis: {
      totalLeads: leads.active,
      newLeads: leads.newLeads,
      contacted: contacts?.leadsContacted ?? 0,
      messagesSent: contacts?.messagesSent ?? 0,
      contactsLogged: contacts?.contactsLogged ?? 0,
      firstContacts: leads.firstContacts,
      responded: leads.responded,
      responseRate: ratio(leads.responded, leads.firstContacts),
      interested,
      opportunities: outcomes?.opportunities ?? 0,
      conversions: outcomes?.conversions ?? 0,
      partners: outcomes?.partners ?? 0,
      customers: outcomes?.customers ?? 0,
      conversionRate: ratio(leads.wonCohort, leads.firstContacts),
      optOuts,
      medianHoursToFirstContact: median === null ? null : Math.round(median * 10) / 10,
      smallSample: isSmallSample(leads.firstContacts),
    },
    /** Funil da coorte: dos primeiros contatos do período, até onde chegaram (até hoje). */
    cohort: {
      firstContacts: leads.firstContacts,
      responded: leads.responded,
      interested: leads.interestedCohort,
      opportunities: leads.opportunitiesCohort,
      won: leads.wonCohort,
    },
  };
}

async function funnel(ctx: UseCaseContext, filter: AnalyticsFilter) {
  const stages = await stageCounts(ctx.tx, filter);
  const total = stages.reduce((sum, s) => sum + s.leads, 0);
  return stages.map((s) => ({ ...s, share: ratio(s.leads, total) }));
}

const DIMENSION_OF: Record<BreakdownDimension, LeadDimension> = {
  city: 'city',
  source: 'source',
  sdr: 'owner',
};

async function labelsFor(ctx: UseCaseContext, dimension: BreakdownDimension, keys: string[]) {
  const ids = keys.filter(Boolean);
  if (dimension === 'city') {
    const rows = await ctx.tx.municipality.findMany({
      where: { ibgeCode: { in: ids.map(Number) } },
      select: { ibgeCode: true, name: true, uf: true },
    });
    return new Map(rows.map((r) => [String(r.ibgeCode), `${r.name}/${r.uf}`]));
  }
  if (dimension === 'source') {
    const rows = await ctx.tx.leadSource.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
  const rows = await ctx.tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

const NULL_LABELS: Record<BreakdownDimension, string> = {
  city: 'Sem cidade',
  source: 'Sem origem',
  sdr: 'Sem responsável',
};

async function breakdown(
  ctx: UseCaseContext,
  filter: AnalyticsFilter,
  dimension: BreakdownDimension,
  limit: number,
  precomputed?: LeadMetricsRow[],
) {
  const leadRows =
    precomputed ??
    (await leadMetrics(ctx.tx, filter, [DIMENSION_OF[dimension]])).get(DIMENSION_OF[dimension])!;
  const [contacts, outcomes] =
    dimension === 'sdr'
      ? await Promise.all([
          contactMetrics(ctx.tx, filter, true),
          outcomeMetrics(ctx.tx, filter, true),
        ])
      : [[], []];
  const keys = [...new Set([...leadRows, ...contacts, ...outcomes].map((r) => r.key ?? ''))];
  const labels = await labelsFor(ctx, dimension, keys);
  const byKey = <T extends { key: string | null }>(rows: T[]) =>
    new Map(rows.map((r) => [r.key ?? '', r]));
  const leadsBy = byKey(leadRows);
  const contactsBy = byKey(contacts);
  const outcomesBy = byKey(outcomes);

  const rows = keys.map((key) => {
    const l = leadsBy.get(key) ?? emptyLeadRow;
    const c = contactsBy.get(key);
    const o = outcomesBy.get(key);
    return {
      key: key || null,
      label: key ? (labels.get(key) ?? 'Removido') : NULL_LABELS[dimension],
      active: l.active,
      newLeads: l.newLeads,
      firstContacts: l.firstContacts,
      responded: l.responded,
      responseRate: ratio(l.responded, l.firstContacts),
      interested: l.interestedCohort,
      opportunities: l.opportunitiesCohort,
      conversions: l.wonCohort,
      conversionRate: ratio(l.wonCohort, l.firstContacts),
      smallSample: isSmallSample(l.firstContacts),
      /** Só por SDR: o que a pessoa fez no período. */
      activity:
        dimension === 'sdr'
          ? {
              leadsContacted: c?.leadsContacted ?? 0,
              messagesSent: c?.messagesSent ?? 0,
              contactsLogged: c?.contactsLogged ?? 0,
              opportunities: o?.opportunities ?? 0,
              conversions: o?.conversions ?? 0,
            }
          : null,
    };
  });
  const activityOf = (r: (typeof rows)[number]) => r.activity?.leadsContacted ?? 0;
  return rows
    .filter((r) => r.newLeads + r.firstContacts + r.active + activityOf(r) > 0)
    .sort(
      (a, b) =>
        b.firstContacts - a.firstContacts ||
        activityOf(b) - activityOf(a) ||
        b.newLeads - a.newLeads ||
        b.active - a.active ||
        a.label.localeCompare(b.label, 'pt-BR'),
    )
    .slice(0, limit);
}

export type BreakdownRow = Awaited<ReturnType<typeof breakdown>>[number];

/** Tudo o que a tela inicial mostra, numa transação só. */
export const getDashboard = defineUseCase({
  name: 'analytics.dashboard',
  access: 'lead.read',
  input: analyticsFilterInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    const teamView = scope.canSeeTeam && !filter.userId;
    // Uma passada nos leads para o total e as três quebras (GROUPING SETS).
    const leads = await leadMetrics(
      ctx.tx,
      filter,
      teamView ? ['none', 'city', 'source', 'owner'] : ['none', 'city', 'source'],
    );
    const [summary, stages, daily, cities, sources, sdrs] = await Promise.all([
      overview(ctx, filter, leads.get('none')![0] ?? emptyLeadRow),
      funnel(ctx, filter),
      dailySeries(ctx.tx, filter),
      breakdown(ctx, filter, 'city', 8, leads.get('city')),
      breakdown(ctx, filter, 'source', 8, leads.get('source')),
      teamView ? breakdown(ctx, filter, 'sdr', 50, leads.get('owner')) : Promise.resolve(null),
    ]);
    return { scope, ...summary, stages, daily, cities, sources, sdrs };
  },
});

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

export const getAnalyticsOverview = defineUseCase({
  name: 'analytics.overview',
  access: 'lead.read',
  input: analyticsFilterInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    return { scope, ...(await overview(ctx, filter)) };
  },
});

export const getStageFunnel = defineUseCase({
  name: 'analytics.funnel',
  access: 'lead.read',
  input: analyticsFilterInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    return { scope, stages: await funnel(ctx, filter) };
  },
});

export const getAnalyticsBreakdown = defineUseCase({
  name: 'analytics.breakdown',
  access: 'lead.read',
  input: breakdownInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    return {
      scope,
      dimension: input.dimension,
      rows: await breakdown(ctx, filter, input.dimension, input.limit),
    };
  },
});

export const getDailySeries = defineUseCase({
  name: 'analytics.timeseries',
  access: 'lead.read',
  input: analyticsFilterInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    return { scope, days: await dailySeries(ctx.tx, filter) };
  },
});

// --- Exportação --------------------------------------------------------------

const pct = (value: number | null) =>
  value === null ? null : (value * 100).toFixed(1).replace('.', ',');
const hours = (value: number | null) => (value === null ? null : String(value).replace('.', ','));

function breakdownCsv(rows: BreakdownRow[], dimension: BreakdownDimension) {
  const first = { city: 'Cidade', source: 'Origem', sdr: 'Responsável' }[dimension];
  const header = [
    first,
    'Leads ativos',
    'Novos no período',
    'Primeiros contatos',
    'Responderam',
    'Taxa de resposta (%)',
    'Interessados',
    'Oportunidades',
    'Conversões',
    'Taxa de conversão (%)',
    'Amostra pequena',
  ];
  const activityHeader = [
    'Leads contatados pela pessoa',
    'Mensagens enviadas',
    'Contatos registrados',
    'Oportunidades transferidas',
    'Conversões das transferidas',
  ];
  return toCsv(
    dimension === 'sdr' ? [...header, ...activityHeader] : header,
    rows.map((r) => {
      const cells: CsvValue[] = [
        r.label,
        r.active,
        r.newLeads,
        r.firstContacts,
        r.responded,
        pct(r.responseRate),
        r.interested,
        r.opportunities,
        r.conversions,
        pct(r.conversionRate),
        r.smallSample ? 'sim' : 'não',
      ];
      if (r.activity) {
        cells.push(
          r.activity.leadsContacted,
          r.activity.messagesSent,
          r.activity.contactsLogged,
          r.activity.opportunities,
          r.activity.conversions,
        );
      }
      return cells;
    }),
  );
}

/**
 * Exportação CSV dos relatórios (M16): ADMIN e GESTOR, auditada. São números
 * agregados; o único dado pessoal é o nome de quem trabalha na equipe.
 */
export const exportAnalyticsReport = defineUseCase({
  name: 'analytics.export',
  access: 'report.read',
  input: exportReportInput,
  async run(ctx, input) {
    const { filter, scope } = await resolveFilter(ctx, input);
    let csv: string;
    let rows: number;
    switch (input.report) {
      case 'overview': {
        const { kpis, cohort } = await overview(ctx, filter);
        const lines: [string, CsvValue][] = [
          ['Total de leads (ativos agora)', kpis.totalLeads],
          ['Novos leads', kpis.newLeads],
          ['Contatados', kpis.contacted],
          ['Mensagens enviadas', kpis.messagesSent],
          ['Contatos registrados', kpis.contactsLogged],
          ['Primeiros contatos (coorte)', kpis.firstContacts],
          ['Responderam (coorte)', kpis.responded],
          ['Taxa de resposta (%)', pct(kpis.responseRate)],
          ['Interessados', kpis.interested],
          ['Oportunidades', kpis.opportunities],
          ['Conversões', kpis.conversions],
          ['Conversões: parceiros', kpis.partners],
          ['Conversões: clientes', kpis.customers],
          ['Taxa de conversão (%) (coorte)', pct(kpis.conversionRate)],
          ['Opt-outs', kpis.optOuts],
          ['Tempo até o 1º contato (mediana, horas)', hours(kpis.medianHoursToFirstContact)],
          ['Coorte: interessados', cohort.interested],
          ['Coorte: oportunidades', cohort.opportunities],
          ['Coorte: conversões', cohort.won],
        ];
        csv = toCsv(['Indicador', 'Valor'], lines);
        rows = lines.length;
        break;
      }
      case 'funnel': {
        const stages = await funnel(ctx, filter);
        csv = toCsv(
          ['Etapa', 'Leads ativos', 'Participação (%)'],
          stages.map((s) => [s.name, s.leads, pct(s.share)]),
        );
        rows = stages.length;
        break;
      }
      case 'daily': {
        const days = await dailySeries(ctx.tx, filter);
        csv = toCsv(
          [
            'Dia',
            'Novos leads',
            'Primeiros contatos',
            'Leads contatados',
            'Leads que responderam',
            'Oportunidades',
            'Conversões',
          ],
          days.map((d) => [
            d.day,
            d.newLeads,
            d.firstContacts,
            d.leadsContacted,
            d.replies,
            d.opportunities,
            d.conversions,
          ]),
        );
        rows = days.length;
        break;
      }
      default: {
        const data = await breakdown(ctx, filter, input.report, 1000);
        csv = breakdownCsv(data, input.report);
        rows = data.length;
      }
    }
    await ctx.audit({
      action: 'report.export',
      entityType: 'report',
      entityId: null,
      metadata: {
        report: input.report,
        from: scope.from,
        to: scope.to,
        userId: filter.userId,
        rows,
      },
    });
    // Só ASCII no nome do arquivo (vai no cabeçalho HTTP).
    const firstName = (scope.person?.name.split(' ')[0] ?? '')
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    const who = firstName ? `-${firstName}` : '';
    return {
      filename: `relatorio-${input.report}${who}-${scope.from}_${scope.to}.csv`,
      title: REPORT_LABELS[input.report],
      csv,
      rows,
    };
  },
});
