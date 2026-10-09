import {
  getAnalyticsBreakdown,
  getAnalyticsOverview,
  getDailySeries,
  getStageFunnel,
  roleHasPermission,
  type ReportKind,
} from '@docline/core';
import {
  matchPreset,
  METRIC_KIND_LABELS,
  METRICS,
  type MetricKey,
} from '@docline/core/analytics-domain';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccessDenied } from '@/components/access-denied';
import { BreakdownTable } from '@/components/analytics/breakdown-table';
import { fmtDate, fmtHours, fmtInt, fmtPct, plural } from '@/components/analytics/format';
import { PeriodFilter } from '@/components/analytics/period-filter';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import {
  analyticsPeople,
  loadAnalytics,
  readAnalyticsParams,
  type AnalyticsParams,
} from '@/server/analytics';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Relatórios' };

function Section({
  title,
  description,
  report,
  query,
  children,
}: {
  title: string;
  description: string;
  report: ReportKind;
  query: string;
  children: ReactNode;
}) {
  return (
    <Card id={report}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/v1/analytics/export?report=${report}&${query}`} download>
            <Download aria-hidden /> CSV
          </a>
        </Button>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Relatórios básicos (M16, F6-09): os mesmos números do dashboard, completos,
 * com exportação CSV auditada. ADMIN e GESTOR.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const params = readAnalyticsParams(await searchParams);
  const actor = user.actor;
  const load = async (input: AnalyticsParams) => {
    const [overview, funnel, cities, sources, sdrs, daily] = await Promise.all([
      getAnalyticsOverview(deps, actor, input, meta),
      getStageFunnel(deps, actor, input, meta),
      getAnalyticsBreakdown(deps, actor, { ...input, dimension: 'city' }, meta),
      getAnalyticsBreakdown(deps, actor, { ...input, dimension: 'source' }, meta),
      input.userId
        ? Promise.resolve(null)
        : getAnalyticsBreakdown(deps, actor, { ...input, dimension: 'sdr' }, meta),
      getDailySeries(deps, actor, input, meta),
    ]);
    return { overview, funnel, cities, sources, sdrs, daily };
  };
  const [{ data, notice }, people] = await Promise.all([
    loadAnalytics(params, load),
    analyticsPeople(user, deps, meta),
  ]);
  const { scope, kpis } = data.overview;
  const now = deps.clock.now();
  const query = new URLSearchParams({ from: scope.from, to: scope.to });
  if (scope.person) query.set('userId', scope.person.id);

  const kpiRows: [MetricKey, string][] = [
    ['totalLeads', fmtInt(kpis.totalLeads)],
    ['newLeads', fmtInt(kpis.newLeads)],
    ['contacted', fmtInt(kpis.contacted)],
    ['firstContacts', fmtInt(kpis.firstContacts)],
    ['responded', fmtInt(kpis.responded)],
    ['responseRate', fmtPct(kpis.responseRate)],
    ['interested', fmtInt(kpis.interested)],
    ['opportunities', fmtInt(kpis.opportunities)],
    [
      'conversions',
      `${fmtInt(kpis.conversions)} (${plural(kpis.partners, 'parceiro', 'parceiros')}, ${plural(kpis.customers, 'cliente', 'clientes')})`,
    ],
    ['conversionRate', fmtPct(kpis.conversionRate)],
    ['optOuts', fmtInt(kpis.optOuts)],
    ['medianHoursToFirstContact', fmtHours(kpis.medianHoursToFirstContact)],
  ];

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`${scope.person ? `Números de ${scope.person.name}` : 'Toda a equipe'} · ${fmtDate(scope.from)} a ${fmtDate(scope.to)}. As exportações ficam registradas na auditoria.`}
      />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <PeriodFilter
        basePath="/relatorios"
        from={scope.from}
        to={scope.to}
        active={matchPreset(scope, now)}
        now={now}
        people={people}
        personId={scope.person?.id ?? null}
      />
      <div className="space-y-4">
        <Section
          title="Indicadores do período"
          description="Cada número com a sua definição."
          report="overview"
          query={query.toString()}
        >
          {kpis.smallSample ? (
            <Alert className="mb-3">
              Menos de 20 primeiros contatos no período: as taxas variam muito com poucos casos.
            </Alert>
          ) : null}
          <Table>
            <THead>
              <Tr>
                <Th>Indicador</Th>
                <Th className="text-right">Valor</Th>
                <Th>Como é calculado</Th>
              </Tr>
            </THead>
            <TBody>
              {kpiRows.map(([key, value]) => (
                <Tr key={key}>
                  <Td className="font-medium">{METRICS[key].label}</Td>
                  <Td className="text-right tabular-nums">{value}</Td>
                  <Td className="text-muted-foreground">
                    {METRICS[key].help}{' '}
                    <span className="text-xs">({METRIC_KIND_LABELS[METRICS[key].kind]})</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section
          title="Funil por etapa"
          description="Leads ativos em cada etapa do pipeline, agora."
          report="funnel"
          query={query.toString()}
        >
          <Table>
            <THead>
              <Tr>
                <Th>Etapa</Th>
                <Th className="text-right">Leads ativos</Th>
                <Th className="text-right">Participação</Th>
              </Tr>
            </THead>
            <TBody>
              {data.funnel.stages.map((s) => (
                <Tr key={s.stageId ?? 'none'}>
                  <Td>{s.name}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(s.leads)}</Td>
                  <Td className="text-right tabular-nums">{fmtPct(s.share)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>

        {data.sdrs ? (
          <Section
            title="Por SDR"
            description="Contatos feitos e oportunidades transferidas pela pessoa no período; novos, 1º contato e taxas são dos leads de que ela é responsável."
            report="sdr"
            query={query.toString()}
          >
            <BreakdownTable rows={data.sdrs.rows} first="Responsável" activity />
          </Section>
        ) : null}

        <Section
          title="Por cidade"
          description="Leads por município, com a coorte do primeiro contato no período."
          report="city"
          query={query.toString()}
        >
          <BreakdownTable rows={data.cities.rows} first="Cidade" />
        </Section>

        <Section
          title="Por origem"
          description="Pela origem principal do lead (primeiro registro)."
          report="source"
          query={query.toString()}
        >
          <BreakdownTable rows={data.sources.rows} first="Origem" />
        </Section>

        <Section
          title="Evolução diária"
          description="Movimento de cada dia do período, no fuso de Fortaleza."
          report="daily"
          query={query.toString()}
        >
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Dia</Th>
                  <Th className="text-right">Novos</Th>
                  <Th className="text-right">1º contato</Th>
                  <Th className="text-right">Contatados</Th>
                  <Th className="text-right">Responderam</Th>
                  <Th className="text-right">Oportunidades</Th>
                  <Th className="text-right">Conversões</Th>
                </Tr>
              </THead>
              <TBody>
                {data.daily.days.map((d) => (
                  <Tr key={d.day}>
                    <Td>{fmtDate(d.day)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.newLeads)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.firstContacts)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.leadsContacted)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.replies)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.opportunities)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(d.conversions)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>
      </div>
    </>
  );
}
