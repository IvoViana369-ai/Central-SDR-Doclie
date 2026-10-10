import { getChannelReport, roleHasPermission } from '@docline/core';
import { matchPreset } from '@docline/core/analytics-domain';
import { AB_MIN_SAMPLE, type AbVerdict } from '@docline/core/campaigns-domain';
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

export const metadata: Metadata = { title: 'Canais' };

/** O mesmo veredito do A/B das campanhas, com as palavras dos canais. */
const VERDICT_LABELS: Record<AbVerdict, string> = {
  INSUFFICIENT_SAMPLE: `Amostra pequena: menos de ${AB_MIN_SAMPLE} primeiros contatos em um dos canais`,
  NO_DIFFERENCE: 'Sem diferença clara até aqui',
  LIKELY_DIFFERENCE: 'Diferença provável; a decisão é do gestor',
};

/** "+12,5 p.p." para a diferença entre duas taxas. */
function points(difference: number | null) {
  if (difference === null) return '—';
  const value = Math.round(difference * 1000) / 10;
  return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`;
}

/**
 * Canais (F11-02): WhatsApp × Instagram lado a lado, e os demais. Volumes
 * pelo canal de cada mensagem; taxas pela coorte do canal do 1º contato. A
 * comparação usa o mesmo teste do A/B das campanhas e nunca declara vencedor.
 */
export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const { from, to } = readAnalyticsParams(await searchParams);
  const { data, notice } = await loadAnalytics({ from, to }, (input) =>
    getChannelReport(deps, user.actor, { from: input.from, to: input.to }, meta),
  );
  const { scope } = data;
  const now = deps.clock.now();
  const exportQuery = new URLSearchParams({ report: 'channels', from: scope.from, to: scope.to });
  const main = data.rows.filter((r) => r.channel === 'WHATSAPP' || r.channel === 'INSTAGRAM');
  const comparisons = [
    { label: 'Resposta', result: data.whatsappVsInstagram.response },
    { label: 'Interesse', result: data.whatsappVsInstagram.interest },
  ];
  const num = 'text-right tabular-nums';

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`Canais · ${fmtDate(scope.from)} a ${fmtDate(scope.to)}.`}
      />
      <ReportTabs active="/relatorios/canais" period={scope} />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <PeriodFilter
        basePath="/relatorios/canais"
        from={scope.from}
        to={scope.to}
        active={matchPreset(scope, now)}
        now={now}
      />
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {main.map((r) => (
          <Card key={r.channel}>
            <CardHeader>
              <CardTitle>{r.label}</CardTitle>
              <CardDescription>
                {fmtInt(r.activity.messagesOut)} mensagens enviadas ·{' '}
                {fmtInt(r.activity.messagesIn)} recebidas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">1ºs contatos</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {fmtInt(r.cohort.firstContacts)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Resposta</dt>
                  <dd className="font-semibold">
                    <RateValue stat={r.rates.response} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Interesse</dt>
                  <dd className="font-semibold">
                    <RateValue stat={r.rates.interest} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Conversão</dt>
                  <dd className="font-semibold">
                    <RateValue stat={r.rates.conversion} />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>WhatsApp × Instagram</CardTitle>
          <CardDescription>
            Diferença das taxas (WhatsApp − Instagram) com o teste de duas proporções, como no A/B
            das campanhas: pede 30 primeiros contatos em cada canal e nunca declara vencedor. Outras
            causas pesam (cidade, abordagem, quem contatou).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {comparisons.map(({ label, result }) => (
              <li key={label} className="flex flex-wrap items-center gap-2">
                <span className="w-24 font-medium">{label}</span>
                <span className="tabular-nums">{points(result?.difference ?? null)}</span>
                {result ? (
                  <Badge variant={result.verdict === 'LIKELY_DIFFERENCE' ? 'success' : 'muted'}>
                    {VERDICT_LABELS[result.verdict]}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Todos os canais</CardTitle>
            <CardDescription>
              Mensagens e contatos pelo canal de cada um; oportunidades, conversões e taxas pelo
              canal do 1º contato do lead. Ligação atendida conta como telefone.
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
                <Th>Canal</Th>
                <Th className="text-right">Enviadas</Th>
                <Th className="text-right">Recebidas</Th>
                <Th className="text-right">Contatos</Th>
                <Th className="text-right">1ºs contatos</Th>
                <Th className="text-right">Resposta</Th>
                <Th className="text-right">Oportunidades</Th>
                <Th className="text-right">Conversão</Th>
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <Tr key={r.channel}>
                  <Td className="font-medium">{r.label}</Td>
                  <Td className={num}>{fmtInt(r.activity.messagesOut)}</Td>
                  <Td className={num}>{fmtInt(r.activity.messagesIn)}</Td>
                  <Td className={num}>{fmtInt(r.activity.contactsLogged)}</Td>
                  <Td className={num}>{fmtInt(r.cohort.firstContacts)}</Td>
                  <Td className="text-right">
                    <RateValue stat={r.rates.response} />
                  </Td>
                  <Td className={num}>{fmtInt(r.cohort.opportunities)}</Td>
                  <Td className="text-right">
                    <RateValue stat={r.rates.conversion} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {data.unidentified > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtInt(data.unidentified)} primeiros contatos sem canal identificado (ex.: só ligação
              não atendida).
            </p>
          ) : null}
          <RateFootnote />
        </CardContent>
      </Card>
    </>
  );
}
