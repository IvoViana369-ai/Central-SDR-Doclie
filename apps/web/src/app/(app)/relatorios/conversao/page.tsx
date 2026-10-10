import { getConversionReport, roleHasPermission } from '@docline/core';
import {
  CONVERSION_DIMENSION_LABELS,
  CONVERSION_DIMENSIONS,
  matchPreset,
  type ConversionDimension,
} from '@docline/core/analytics-domain';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { fmtDate, fmtInt } from '@/components/analytics/format';
import { Freshness } from '@/components/analytics/freshness';
import { PeriodFilter } from '@/components/analytics/period-filter';
import { RateFootnote, RateValue } from '@/components/analytics/rate-value';
import { ReportTabs } from '@/components/analytics/report-tabs';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { analyticsPeople, loadAnalytics, readAnalyticsParams } from '@/server/analytics';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Conversão por recorte' };

const isDimension = (value: unknown): value is ConversionDimension =>
  typeof value === 'string' && (CONVERSION_DIMENSIONS as readonly string[]).includes(value);

/**
 * Conversão por recorte (F11-02/F11-03): cidade, UF, segmento, origem,
 * responsável, quem fez o 1º contato, campanha, abordagem e canal, pela coorte
 * do 1º contato no período, com intervalo de confiança. ADMIN e GESTOR.
 */
export default async function ConversionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const search = await searchParams;
  const params = readAnalyticsParams(search);
  const dimension = isDimension(search.recorte) ? search.recorte : 'city';
  const [{ data, notice }, people] = await Promise.all([
    loadAnalytics(params, (input) =>
      getConversionReport(deps, user.actor, { ...input, dimension }, meta),
    ),
    analyticsPeople(user, deps, meta),
  ]);
  const { scope, total } = data;
  const now = deps.clock.now();
  const base = new URLSearchParams({ de: scope.from, ate: scope.to });
  if (scope.person) base.set('pessoa', scope.person.id);
  const exportQuery = new URLSearchParams({
    report: 'conversion',
    dimension,
    from: scope.from,
    to: scope.to,
  });
  if (scope.person) exportQuery.set('userId', scope.person.id);
  const num = 'text-right tabular-nums';

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`${scope.person ? `1ºs contatos feitos por ${scope.person.name}` : 'Toda a equipe'} · coorte do 1º contato de ${fmtDate(scope.from)} a ${fmtDate(scope.to)}, acompanhada até hoje.`}
      />
      <ReportTabs active="/relatorios/conversao" period={scope} />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <PeriodFilter
        basePath="/relatorios/conversao"
        from={scope.from}
        to={scope.to}
        active={matchPreset(scope, now)}
        now={now}
        people={people}
        personId={scope.person?.id ?? null}
        extra={{ recorte: dimension }}
      />
      <nav aria-label="Recorte" className="mb-4 flex flex-wrap gap-1">
        {CONVERSION_DIMENSIONS.map((d) => {
          const query = new URLSearchParams(base);
          query.set('recorte', d);
          return (
            <Link
              key={d}
              href={`/relatorios/conversao?${query}`}
              aria-current={d === dimension ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted',
                d === dimension
                  ? 'border-primary bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {CONVERSION_DIMENSION_LABELS[d]}
            </Link>
          );
        })}
      </nav>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Conversão por {data.dimensionLabel.toLowerCase()}</CardTitle>
            <CardDescription>
              Cada lead entra uma vez: no recorte do seu 1º contato (canal, abordagem, campanha e
              quem fez) ou do seu cadastro (cidade, UF, segmento, origem, responsável). Taxas sobre
              os primeiros contatos.
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
          {total.firstContacts === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum primeiro contato no período.
            </p>
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>{data.dimensionLabel}</Th>
                    <Th className="text-right">1ºs contatos</Th>
                    <Th className="text-right">Resposta</Th>
                    <Th className="text-right">Interesse</Th>
                    <Th className="text-right">Oportunidade</Th>
                    <Th className="text-right">Conversão</Th>
                    <Th className="text-right" title="Pediram para sair (Lista Não Contatar)">
                      Opt-outs
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.rows.map((r) => (
                    <Tr key={r.key ?? 'none'}>
                      <Td className="font-medium">{r.label}</Td>
                      <Td className={num}>{fmtInt(r.firstContacts)}</Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.response} />
                      </Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.interest} />
                      </Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.opportunity} />
                      </Td>
                      <Td className="text-right">
                        <RateValue stat={r.rates.conversion} />
                      </Td>
                      <Td className={num}>{fmtInt(r.optedOut)}</Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 font-medium">
                    <Td>Total</Td>
                    <Td className={num}>{fmtInt(total.firstContacts)}</Td>
                    <Td className="text-right">
                      <RateValue stat={total.rates.response} compare={false} />
                    </Td>
                    <Td className="text-right">
                      <RateValue stat={total.rates.interest} compare={false} />
                    </Td>
                    <Td className="text-right">
                      <RateValue stat={total.rates.opportunity} compare={false} />
                    </Td>
                    <Td className="text-right">
                      <RateValue stat={total.rates.conversion} compare={false} />
                    </Td>
                    <Td className={num}>{fmtInt(total.optedOut)}</Td>
                  </Tr>
                </TBody>
              </Table>
              {data.truncated ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Mostrando os {fmtInt(data.rows.length)} recortes com mais primeiros contatos; o
                  CSV traz até 1.000.
                </p>
              ) : null}
              <RateFootnote />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
