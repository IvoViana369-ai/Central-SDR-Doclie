import {
  getMonthlyEvolution,
  NotFoundError,
  roleHasPermission,
  ValidationError,
  type MonthlyReport,
} from '@docline/core';
import { MAX_MONTHS, monthLabel } from '@docline/core/analytics-domain';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { BarList } from '@/components/analytics/bar-list';
import { fmtInt } from '@/components/analytics/format';
import { Freshness } from '@/components/analytics/freshness';
import { RateFootnote, RateValue } from '@/components/analytics/rate-value';
import { ReportTabs } from '@/components/analytics/report-tabs';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { analyticsPeople, readAnalyticsParams } from '@/server/analytics';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Evolução mensal' };

/**
 * Evolução mensal (F11-02): volumes de cada mês (rollup diário) e a coorte do
 * 1º contato de cada mês, com intervalo de confiança e comparação com a média
 * do intervalo. Padrão: últimos 12 meses. ADMIN e GESTOR.
 */
export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const params = readAnalyticsParams(await searchParams);
  const load = (input: { fromMonth?: string; toMonth?: string; userId?: string }) =>
    getMonthlyEvolution(deps, user.actor, input, meta);
  let data: MonthlyReport;
  let notice: string | null = null;
  try {
    data = await load({ fromMonth: params.from, toMonth: params.to, userId: params.userId });
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof NotFoundError)) throw error;
    const message =
      error instanceof ValidationError
        ? (error.issues[0]?.message ?? 'Meses inválidos.')
        : error.message;
    notice = `${message} Mostrando os últimos 12 meses.`;
    data = await load({});
  }
  const people = await analyticsPeople(user, deps, meta);
  const { scope, total } = data;
  const exportQuery = new URLSearchParams({
    report: 'monthly',
    fromMonth: scope.from,
    toMonth: scope.to,
  });
  if (scope.person) exportQuery.set('userId', scope.person.id);
  const num = 'text-right tabular-nums';
  const input = 'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground';

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`Evolução mensal · ${scope.person ? scope.person.name : 'toda a equipe'} · ${monthLabel(scope.from)} a ${monthLabel(scope.to)}.`}
      />
      <ReportTabs active="/relatorios/mensal" />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <form
        method="get"
        action="/relatorios/mensal"
        className="mb-6 flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          De (mês)
          <input type="month" name="de" defaultValue={scope.from} required className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Até (mês)
          <input type="month" name="ate" defaultValue={scope.to} required className={input} />
        </label>
        {people ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Pessoa
            <select
              name="pessoa"
              defaultValue={scope.person?.id ?? ''}
              className={`${input} max-w-52`}
            >
              <option value="">Toda a equipe</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" variant="outline" size="sm" className="h-9">
          Aplicar
        </Button>
        <span className="text-xs text-muted-foreground">Até {MAX_MONTHS} meses.</span>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1ºs contatos por mês</CardTitle>
            <CardDescription>Leads contatados pela primeira vez em cada mês.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Primeiros contatos por mês"
              empty="Nenhum primeiro contato no intervalo."
              rows={data.months.map((m) => ({
                key: m.month,
                label: m.partial ? `${m.label} (parcial)` : m.label,
                value: m.cohort.firstContacts,
              }))}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Mês a mês</CardTitle>
              <CardDescription>
                Volumes: o que aconteceu no mês. Taxas: dos 1ºs contatos de cada mês, acompanhados
                até hoje (meses recentes ainda podem subir), comparadas com a média do intervalo.
                {scope.person ? ' Com uma pessoa: os 1ºs contatos que ela fez.' : ''}
              </CardDescription>
              <Freshness refreshedAt={data.freshness.refreshedAt} />
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/analytics/performance-export?${exportQuery}`} download>
                <Download aria-hidden /> CSV
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th>Mês</Th>
                  <Th className="text-right">Novos</Th>
                  <Th className="text-right">1ºs contatos</Th>
                  <Th className="text-right">Mensagens</Th>
                  <Th className="text-right">Oportunidades</Th>
                  <Th className="text-right">Conversões</Th>
                  <Th className="text-right">Resposta</Th>
                  <Th className="text-right">Conversão</Th>
                </Tr>
              </THead>
              <TBody>
                {data.months.map((m) => (
                  <Tr key={m.month}>
                    <Td className="font-medium whitespace-nowrap">
                      {m.label}
                      {m.partial ? (
                        <span className="ml-1 text-xs text-muted-foreground">(parcial)</span>
                      ) : null}
                    </Td>
                    <Td className={num}>{fmtInt(m.activity.newLeads)}</Td>
                    <Td className={num}>{fmtInt(m.cohort.firstContacts)}</Td>
                    <Td className={num}>{fmtInt(m.activity.messagesOut)}</Td>
                    <Td className={num}>{fmtInt(m.activity.opportunities)}</Td>
                    <Td className={num}>{fmtInt(m.activity.conversions)}</Td>
                    <Td className="text-right">
                      <RateValue stat={m.rates.response} />
                    </Td>
                    <Td className="text-right">
                      <RateValue stat={m.rates.conversion} />
                    </Td>
                  </Tr>
                ))}
                <Tr className="border-t-2 font-medium">
                  <Td>Total</Td>
                  <Td className={num}>{fmtInt(total.activity.newLeads)}</Td>
                  <Td className={num}>{fmtInt(total.cohort.firstContacts)}</Td>
                  <Td className={num}>{fmtInt(total.activity.messagesOut)}</Td>
                  <Td className={num}>{fmtInt(total.activity.opportunities)}</Td>
                  <Td className={num}>{fmtInt(total.activity.conversions)}</Td>
                  <Td className="text-right">
                    <RateValue stat={total.rates.response} compare={false} />
                  </Td>
                  <Td className="text-right">
                    <RateValue stat={total.rates.conversion} compare={false} />
                  </Td>
                </Tr>
              </TBody>
            </Table>
            <RateFootnote />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
