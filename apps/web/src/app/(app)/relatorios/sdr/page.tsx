import { getSdrPerformance, roleHasPermission } from '@docline/core';
import { matchPreset } from '@docline/core/analytics-domain';
import { ROLE_LABELS } from '@docline/core/roles';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { fmtDate, fmtInt } from '@/components/analytics/format';
import { Freshness } from '@/components/analytics/freshness';
import { PeriodFilter } from '@/components/analytics/period-filter';
import { RateFootnote, RateValue } from '@/components/analytics/rate-value';
import { ReportTabs } from '@/components/analytics/report-tabs';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { loadAnalytics, readAnalyticsParams } from '@/server/analytics';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Desempenho por SDR' };

/**
 * Desempenho por SDR (F11-02): carteira ativa agora, o que a pessoa fez no
 * período (rollup diário) e a coorte dos 1ºs contatos que ela fez, com
 * intervalo de confiança e comparação com a equipe. ADMIN e GESTOR.
 */
export default async function SdrPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const { from, to } = readAnalyticsParams(await searchParams);
  const { data, notice } = await loadAnalytics({ from, to }, (input) =>
    getSdrPerformance(deps, user.actor, { from: input.from, to: input.to }, meta),
  );
  const { scope, team } = data;
  const now = deps.clock.now();
  const exportQuery = new URLSearchParams({
    report: 'sdrPerformance',
    from: scope.from,
    to: scope.to,
  });
  const num = 'text-right tabular-nums';

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`Por SDR · ${fmtDate(scope.from)} a ${fmtDate(scope.to)}.`}
      />
      <ReportTabs active="/relatorios/sdr" period={scope} />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <PeriodFilter
        basePath="/relatorios/sdr"
        from={scope.from}
        to={scope.to}
        active={matchPreset(scope, now)}
        now={now}
      />
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Desempenho por SDR</CardTitle>
            <CardDescription>
              Atividade: o que a pessoa fez no período (mensagens, contatos registrados,
              transferências e as conversões delas); respostas recebidas e opt-outs são dos leads de
              que ela é responsável. Taxas: dos 1ºs contatos que ela fez no período, comparadas com
              a equipe.
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
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum SDR ativo nem atividade no período.
            </p>
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>Pessoa</Th>
                    <Th className="text-right" title="Leads ativos de que é responsável, agora">
                      Carteira
                    </Th>
                    <Th className="text-right">Mensagens</Th>
                    <Th className="text-right" title="Ligações, reuniões e visitas registradas">
                      Contatos
                    </Th>
                    <Th className="text-right">Recebidas</Th>
                    <Th className="text-right">Oportunidades</Th>
                    <Th className="text-right">Conversões</Th>
                    <Th className="text-right">1ºs contatos</Th>
                    <Th className="text-right">Resposta</Th>
                    <Th className="text-right">Conversão</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.rows.map((r) => (
                    <Tr key={r.userId}>
                      <Td className="font-medium">
                        {r.name}
                        {r.role !== 'SDR' ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({ROLE_LABELS[r.role]})
                          </span>
                        ) : null}
                        {!r.active ? (
                          <Badge variant="muted" className="ml-1">
                            Inativo
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className={num}>{fmtInt(r.portfolio)}</Td>
                      <Td className={num}>{fmtInt(r.activity.messagesOut)}</Td>
                      <Td className={num}>{fmtInt(r.activity.contactsLogged)}</Td>
                      <Td className={num}>{fmtInt(r.activity.messagesIn)}</Td>
                      <Td className={num}>{fmtInt(r.activity.opportunities)}</Td>
                      <Td className={num}>{fmtInt(r.activity.conversions)}</Td>
                      <Td className={num}>{fmtInt(r.cohort.firstContacts)}</Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.response} />
                      </Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.conversion} />
                      </Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 font-medium">
                    <Td>Equipe</Td>
                    <Td className={num}>—</Td>
                    <Td className={num}>{fmtInt(team.activity.messagesOut)}</Td>
                    <Td className={num}>{fmtInt(team.activity.contactsLogged)}</Td>
                    <Td className={num}>{fmtInt(team.activity.messagesIn)}</Td>
                    <Td className={num}>{fmtInt(team.activity.opportunities)}</Td>
                    <Td className={num}>{fmtInt(team.activity.conversions)}</Td>
                    <Td className={num}>{fmtInt(team.cohort.firstContacts)}</Td>
                    <Td className="text-right">
                      <RateValue stat={team.rates.response} compare={false} />
                    </Td>
                    <Td className="text-right">
                      <RateValue stat={team.rates.conversion} compare={false} />
                    </Td>
                  </Tr>
                </TBody>
              </Table>
              <RateFootnote />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
