import type { getCampaign } from '@docline/core';
import {
  AB_MIN_SAMPLE,
  AB_VERDICT_LABELS,
  ATTRIBUTION_DAYS,
  FUNNEL_STEP_HELP,
  FUNNEL_STEP_LABELS,
  INELIGIBILITY_REASON_LABELS,
  INELIGIBILITY_REASONS,
  type AbComparison,
} from '@docline/core/campaigns-domain';
import { GATE_CHANNEL_LABELS } from '@docline/core/compliance-domain';
import { BarList } from '@/components/analytics/bar-list';
import { fmtInt, fmtPct } from '@/components/analytics/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/utils';
import { BuildingRefresher } from './campaign-actions';
import { CampaignLeads } from './campaign-leads';

type Detail = Awaited<ReturnType<typeof getCampaign>>;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: number;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border p-3" title={hint} data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{fmtInt(value)}</p>
    </div>
  );
}

function signedPoints(difference: number | null): string {
  if (difference === null) return '—';
  const points = (difference * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `${difference > 0 ? '+' : ''}${points} p.p.`;
}

function Comparisons({ title, rows }: { title: string; rows: AbComparison[] }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-1 text-sm">
        {rows.map((c) => (
          <li key={c.variantId} className="flex flex-wrap items-center gap-2">
            <span>
              {c.label} × {c.baselineLabel}: {signedPoints(c.difference)}
            </span>
            <Badge variant={c.verdict === 'LIKELY_DIFFERENCE' ? 'success' : 'muted'}>
              {AB_VERDICT_LABELS[c.verdict]}
            </Badge>
            {c.pValue !== null ? (
              <span className="text-xs text-muted-foreground">
                p = {c.pValue.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CampaignDetailView({ detail }: { detail: Detail }) {
  const { campaign, counts, funnel, bySdr, variants, abTest, skippedReasons } = detail;
  const reasons = INELIGIBILITY_REASONS.filter((r) => (skippedReasons[r] ?? 0) > 0).map((r) => ({
    key: r,
    label: INELIGIBILITY_REASON_LABELS[r],
    value: skippedReasons[r] ?? 0,
  }));
  const canRemove = ['READY', 'ACTIVE', 'PAUSED'].includes(campaign.status);
  const baseLabel = (step: string | null) =>
    step ? FUNNEL_STEP_LABELS[step as keyof typeof FUNNEL_STEP_LABELS].toLowerCase() : '';

  return (
    <div className="space-y-4">
      {campaign.status === 'BUILDING' ? (
        <>
          <BuildingRefresher />
          <Alert title="Montando a campanha…">
            Congelando a seleção e avaliando cada lead. A página atualiza sozinha.
          </Alert>
        </>
      ) : null}
      {campaign.status === 'DRAFT' && campaign.buildError ? (
        <Alert variant="error" title="A última montagem não deu certo">
          {campaign.buildError}
        </Alert>
      ) : null}
      {campaign.status === 'READY' ? (
        <Alert title="Pronta para ativar">
          Retrato de {formatDateTime(campaign.snapshotAt)}: {fmtInt(counts.pending)} leads aptos
          aguardando. Ao ativar, até {fmtInt(campaign.dailyContactLimit)} por SDR por dia entram na
          cadência. Nada é enviado pela campanha.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          {campaign.objective ? <CardDescription>{campaign.objective}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Canal">
              {GATE_CHANNEL_LABELS[campaign.channel as keyof typeof GATE_CHANNEL_LABELS] ??
                campaign.channel}
            </Info>
            <Info label="Cadência">{campaign.cadence?.name ?? 'A padrão'}</Info>
            <Info label="Responsável">{campaign.owner.name}</Info>
            <Info label="Leads por SDR por dia">{fmtInt(campaign.dailyContactLimit)}</Info>
            <Info label="SDRs">{campaign.sdrs.map((s) => s.name).join(', ') || '—'}</Info>
            <Info label="Frequência">
              {campaign.minDaysSinceLastContact > 0
                ? `Sem contato há ${campaign.minDaysSinceLastContact} dias ou mais`
                : 'Sem regra'}
            </Info>
            <Info label="Período">
              {campaign.startsAt || campaign.endsAt
                ? `${formatDate(campaign.startsAt)} a ${formatDate(campaign.endsAt)}`
                : 'Sem datas'}
            </Info>
            <Info label="Seleção">{campaign.filterLabel ?? 'Filtro da lista de leads'}</Info>
          </dl>
        </CardContent>
      </Card>

      {counts.selected > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Retrato</CardTitle>
            <CardDescription>
              Seleção congelada em {formatDateTime(campaign.snapshotAt)}. Cada lead é conferido de
              novo na hora de entrar na fila.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Selecionados" value={counts.selected} testId="campaign-selected" />
              <Stat label="Aptos" value={counts.eligible} testId="campaign-eligible" />
              <Stat label="Aguardando liberação" value={counts.pending} testId="campaign-pending" />
              <Stat
                label="Liberados para a fila"
                value={counts.released}
                testId="campaign-released"
              />
              <Stat
                testId="campaign-skipped"
                label="Não liberados"
                value={counts.skipped}
                hint="Inaptos na montagem ou na hora de liberar."
              />
            </div>
            {reasons.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Por que não foram liberados</p>
                <p className="text-xs text-muted-foreground">Um lead pode ter mais de um motivo.</p>
                <BarList rows={reasons} label="Motivos de inelegibilidade" />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {counts.released > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Funil</CardTitle>
            <CardDescription>
              Contam os marcos de até {ATTRIBUTION_DAYS} dias depois de cada liberação (ou até o
              lead entrar em outra campanha). Atualizado de hora em hora e ao abrir esta página.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th>Passo</Th>
                  <Th className="text-right">Leads</Th>
                  <Th className="text-right">Taxa</Th>
                </Tr>
              </THead>
              <TBody>
                {funnel.map((row) => (
                  <Tr key={row.step}>
                    <Td title={row.step === 'optedOut' ? undefined : FUNNEL_STEP_HELP[row.step]}>
                      {row.label}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.count)}</Td>
                    <Td className="text-right text-muted-foreground tabular-nums">
                      {row.base && row.rate !== null
                        ? `${fmtPct(row.rate)} dos ${baseLabel(row.base)}`
                        : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {counts.eligible > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por SDR</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th>SDR</Th>
                  <Th className="text-right">Aguardando</Th>
                  <Th className="text-right">Liberados</Th>
                  <Th className="text-right">Hoje</Th>
                  <Th className="text-right">Contatados</Th>
                  <Th className="text-right">Responderam</Th>
                  <Th className="text-right">Oportunidades</Th>
                </Tr>
              </THead>
              <TBody>
                {bySdr.map((row) => (
                  <Tr key={row.userId} data-testid="campaign-sdr-row">
                    <Td>
                      {row.name}
                      {!row.active ? (
                        <Badge variant="warning" className="ml-2">
                          Inativo
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.pending)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.released)}</Td>
                    <Td className="text-right tabular-nums">
                      {fmtInt(row.releasedToday)}/{fmtInt(campaign.dailyContactLimit)}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.contacted)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.replied)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(row.opportunity)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {variants.length > 0 && counts.selected > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{variants.length > 1 ? 'Teste A/B de abordagens' : 'Abordagem'}</CardTitle>
            <CardDescription>
              {variants.length > 1
                ? `Cada lead recebe uma variante ao montar, alternada dentro da lista de cada SDR. A comparação só aparece com ${AB_MIN_SAMPLE} contatados em cada variante; a decisão é sempre do gestor.`
                : 'Todos os leads com a mesma abordagem.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <THead>
                <Tr>
                  <Th>Variante</Th>
                  <Th className="text-right">Liberados</Th>
                  <Th className="text-right">Contatados</Th>
                  <Th className="text-right">Respostas</Th>
                  <Th className="text-right">Interesse</Th>
                  <Th className="text-right">Oportunidades</Th>
                  <Th className="text-right">Saídas</Th>
                </Tr>
              </THead>
              <TBody>
                {variants.map((v) => (
                  <Tr key={v.id}>
                    <Td>
                      <span className="font-medium">
                        {v.label} · {v.approach.name}
                      </span>
                      {v.approach.hypothesis ? (
                        <p className="text-xs text-muted-foreground">{v.approach.hypothesis}</p>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(v.released)}</Td>
                    <Td className="text-right tabular-nums">{fmtInt(v.contacted)}</Td>
                    <Td className="text-right tabular-nums">
                      {fmtInt(v.replied)} ({fmtPct(v.replyRate)})
                    </Td>
                    <Td className="text-right tabular-nums">
                      {fmtInt(v.interested)} ({fmtPct(v.interestRate)})
                    </Td>
                    <Td className="text-right tabular-nums">
                      {fmtInt(v.opportunity)} ({fmtPct(v.opportunityRate)})
                    </Td>
                    <Td className="text-right tabular-nums">
                      {fmtInt(v.optedOut)} ({fmtPct(v.optOutRate)})
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {abTest ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Comparisons title="Taxa de resposta" rows={abTest.replied} />
                <Comparisons title="Taxa de interesse" rows={abTest.interested} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {counts.selected > 0 ? (
        <CampaignLeads
          campaignId={campaign.id}
          sdrs={
            bySdr.length > 0 ? bySdr.map((s) => ({ id: s.userId, name: s.name })) : campaign.sdrs
          }
          variants={variants.map((v) => ({ id: v.id, label: v.label }))}
          canRemove={canRemove}
        />
      ) : null}
    </div>
  );
}
