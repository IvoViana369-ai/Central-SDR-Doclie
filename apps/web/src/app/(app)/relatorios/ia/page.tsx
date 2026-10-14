import { AI_STATUS_LABELS, getAiUsage, roleHasPermission, ValidationError } from '@docline/core';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/access-denied';
import { fmtInt, fmtPct } from '@/components/analytics/format';
import { ReportTabs } from '@/components/analytics/report-tabs';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { getPageContext } from '@/server/page-context';

export const metadata: Metadata = { title: 'Uso e custos da IA' };

/** Classificação não vira rascunho: "gerada" ali é "sugerida". */
const statusLabel = (kind: string, status: string) =>
  kind === 'REPLY_CLASSIFICATION' && status === 'GENERATED'
    ? 'Sugerida'
    : (AI_STATUS_LABELS[status as keyof typeof AI_STATUS_LABELS] ?? status);

const usd = (value: number) =>
  `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/**
 * Uso, custo e qualidade da IA no mês (docs/AI-SDR.md §11 e §15): gasto
 * contra o orçamento, por tipo, pessoa e versão de prompt, e as métricas de
 * qualidade (aprovado sem edição, edição média, descartes e motivos).
 */
export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, deps, meta } = await getPageContext();
  if (!roleHasPermission(user.actor.role, 'report.read')) return <AccessDenied />;
  const requested = (await searchParams).mes;
  const month = typeof requested === 'string' && requested ? requested : undefined;
  let notice: string | null = null;
  let usage;
  try {
    usage = await getAiUsage(deps, user.actor, { month }, meta);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    notice = 'Mês inválido. Mostrando o mês atual.';
    usage = await getAiUsage(deps, user.actor, {}, meta);
  }
  const share = usage.budgetUsd ? usage.spentUsd / usage.budgetUsd : null;
  const q = usage.quality;

  return (
    <>
      <PageHeader
        title="Uso e custos da IA"
        description={`${usage.month} · provedor ${usage.provider} (${usage.models.generation}). Custos estimados pela tabela de preços; a fatura do fornecedor é a fonte oficial.`}
      />
      <ReportTabs active="/relatorios/ia" />
      {notice ? (
        <Alert variant="error" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      <form method="get" className="mb-6 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Mês
          <input
            type="month"
            name="mes"
            defaultValue={usage.month}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <Button type="submit" variant="outline" size="sm" className="h-9">
          Ver
        </Button>
      </form>

      <section aria-label="Resumo do mês" className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-sm text-muted-foreground">Gasto estimado</p>
          <p className="text-2xl font-semibold tracking-tight">{usd(usage.spentUsd)}</p>
          {usage.budgetUsd !== null && share !== null ? (
            <>
              <div
                className="mt-2 h-2 rounded-full bg-primary/15"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(share * 100)}
                aria-label="Orçamento usado"
              >
                <div
                  className={cn(
                    'h-2 rounded-full',
                    share >= 1 ? 'bg-destructive' : share >= 0.8 ? 'bg-warning' : 'bg-primary',
                  )}
                  style={{ width: `${Math.min(100, share * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtPct(share)} do orçamento de {usd(usage.budgetUsd)}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Sem orçamento mensal definido.</p>
          )}
        </div>
        <Stat
          label="Pedidos à IA"
          value={fmtInt(usage.requests)}
          detail={`${fmtInt(usage.tokens.input)} tokens de entrada · ${fmtInt(usage.tokens.output)} de saída · ${fmtInt(usage.tokens.cachedInput)} do cache`}
        />
        <Stat
          label="Aprovados sem edição"
          value={fmtPct(q.approved ? q.approvedWithoutEdit / q.approved : null)}
          detail={`${fmtInt(q.approvedWithoutEdit)} de ${fmtInt(q.approved)} aprovados · edição média ${fmtPct(q.avgEditRatio)}`}
        />
        <Stat
          label="Descartados"
          value={fmtInt(q.discarded)}
          detail={`de ${fmtInt(q.draftsCreated)} rascunhos criados`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por tipo</CardTitle>
            <CardDescription>Pedidos, situação e custo por tipo de geração.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.byKind.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum uso no mês.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Tipo</Th>
                    <Th className="text-right">Pedidos</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">Custo</Th>
                  </Tr>
                </THead>
                <TBody>
                  {usage.byKind.map((k) => (
                    <Tr key={k.kind}>
                      <Td className="font-medium">{k.label}</Td>
                      <Td className="text-right tabular-nums">{fmtInt(k.count)}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {Object.entries(k.byStatus)
                          .map(([status, n]) => `${statusLabel(k.kind, status)}: ${n}`)
                          .join(' · ')}
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {usd(k.costUsd)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Por pessoa</CardTitle>
            <CardDescription>Quem pediu, quantas vezes e quanto custou.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.byUser.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum uso no mês.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Pessoa</Th>
                    <Th className="text-right">Pedidos</Th>
                    <Th className="text-right">Custo</Th>
                  </Tr>
                </THead>
                <TBody>
                  {usage.byUser.map((u) => (
                    <Tr key={u.userId ?? 'system'}>
                      <Td className="font-medium">{u.name}</Td>
                      <Td className="text-right tabular-nums">{fmtInt(u.count)}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {usd(u.costUsd)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Por versão de prompt</CardTitle>
            <CardDescription>
              Compare versões pela edição média e pela nota dos SDRs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usage.byPrompt.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum uso no mês.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Prompt</Th>
                    <Th className="text-right">Pedidos</Th>
                    <Th className="text-right">Edição média</Th>
                    <Th className="text-right">Nota média</Th>
                  </Tr>
                </THead>
                <TBody>
                  {usage.byPrompt.map((p) => (
                    <Tr key={p.prompt}>
                      <Td className="font-mono text-xs">{p.prompt}</Td>
                      <Td className="text-right tabular-nums">{fmtInt(p.count)}</Td>
                      <Td className="text-right tabular-nums">{fmtPct(p.avgEditRatio)}</Td>
                      <Td className="text-right tabular-nums">
                        {p.avgRating === null
                          ? '—'
                          : p.avgRating.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Motivos de descarte</CardTitle>
            <CardDescription>O que mais faz o SDR desistir do rascunho.</CardDescription>
          </CardHeader>
          <CardContent>
            {usage.discardReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum descarte no mês.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {usage.discardReasons.map((d) => (
                  <li key={d.reason} className="flex justify-between gap-3">
                    <span>{d.reason}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtInt(d.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
