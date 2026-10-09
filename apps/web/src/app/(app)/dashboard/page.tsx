import { getDashboard } from '@docline/core';
import { matchPreset } from '@docline/core/analytics-domain';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarList } from '@/components/analytics/bar-list';
import { BreakdownTable } from '@/components/analytics/breakdown-table';
import { DailyChart } from '@/components/analytics/daily-chart';
import { fmtDate } from '@/components/analytics/format';
import { KpiGrid } from '@/components/analytics/kpi-grid';
import { PeriodFilter } from '@/components/analytics/period-filter';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { analyticsPeople, loadAnalytics, readAnalyticsParams } from '@/server/analytics';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Dashboard' };

/** Dashboard (M16): indicadores do período, evolução diária, funis e quebras. */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  const params = readAnalyticsParams(await searchParams);
  const [{ data, notice }, people] = await Promise.all([
    loadAnalytics(params, (input) => getDashboard(deps, user.actor, input, meta)),
    analyticsPeople(user, deps, meta),
  ]);
  const { scope, kpis, cohort } = data;
  const now = deps.clock.now();
  const who = scope.canSeeTeam
    ? scope.person
      ? `Números de ${scope.person.name}`
      : 'Números da equipe'
    : 'Seus números';
  const pct = (part: number) => (cohort.firstContacts > 0 ? part / cohort.firstContacts : null);

  return (
    <>
      <PageHeader
        title={`Olá, ${user.name.split(' ')[0]}!`}
        description={`${who} · ${fmtDate(scope.from)} a ${fmtDate(scope.to)}`}
        actions={
          scope.canSeeTeam ? (
            <Button asChild variant="outline">
              <Link href={`/relatorios?de=${scope.from}&ate=${scope.to}`}>
                Relatórios <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null
        }
      />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <PeriodFilter
        basePath="/dashboard"
        from={scope.from}
        to={scope.to}
        active={matchPreset(scope, now)}
        now={now}
        people={people}
        personId={scope.canSeeTeam ? (scope.person?.id ?? null) : null}
      />
      <KpiGrid kpis={kpis} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolução diária</CardTitle>
            <CardDescription>
              Leads cadastrados, primeiros contatos e respostas por dia.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-hidden">
            <DailyChart days={data.daily} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funil da coorte</CardTitle>
            <CardDescription>
              Dos primeiros contatos do período, até onde chegaram (até hoje).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Funil da coorte"
              empty="Nenhum primeiro contato no período."
              rows={[
                { key: 'first', label: 'Primeiros contatos', value: cohort.firstContacts },
                {
                  key: 'responded',
                  label: 'Responderam',
                  value: cohort.responded,
                  share: pct(cohort.responded),
                },
                {
                  key: 'interested',
                  label: 'Interessados',
                  value: cohort.interested,
                  share: pct(cohort.interested),
                },
                {
                  key: 'opportunities',
                  label: 'Oportunidades',
                  value: cohort.opportunities,
                  share: pct(cohort.opportunities),
                },
                { key: 'won', label: 'Conversões', value: cohort.won, share: pct(cohort.won) },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funil por etapa</CardTitle>
            <CardDescription>Leads ativos em cada etapa, agora.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Leads por etapa"
              empty="Nenhum lead ativo."
              rows={data.stages.map((s) => ({
                key: s.stageId ?? 'none',
                label: s.name,
                value: s.leads,
                share: s.share,
                muted: s.category === 'LOST' || s.category === 'PARKED',
              }))}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Por cidade</CardTitle>
            <CardDescription>As cidades com mais primeiros contatos no período.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownTable rows={data.cities} first="Cidade" compact />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className={data.sdrs ? '' : 'lg:col-span-2'}>
          <CardHeader>
            <CardTitle>Por origem</CardTitle>
            <CardDescription>De onde vieram os leads trabalhados.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownTable rows={data.sources} first="Origem" compact />
          </CardContent>
        </Card>
        {data.sdrs ? (
          <Card>
            <CardHeader>
              <CardTitle>Por SDR</CardTitle>
              <CardDescription>
                Contatos feitos pela pessoa no período e a coorte dos leads dela.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable rows={data.sdrs} first="Responsável" activity compact />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
