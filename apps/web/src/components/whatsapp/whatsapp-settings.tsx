'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface WhatsappOverviewView {
  provider: string | null;
  month: string;
  connection: {
    status: string;
    config: unknown;
    lastCheckAt: Date_ | null;
    lastError: string | null;
  } | null;
  settings: {
    pricesUsd: { marketing: number; utility: number; authentication: number; service: number };
    autoSuggestClassification: boolean;
  };
  pendingUnmatched: number;
  totals: {
    requested: number;
    accepted: number;
    delivered: number;
    read: number;
    failed: number;
    costUsd: number;
  };
  byCategory: { category: string; count: number; costUsd: number }[];
  failures: { code: string; count: number; message: string }[];
}

export interface WhatsappTemplateRow {
  id: string;
  name: string;
  language: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  supported: boolean;
  unsupportedReason: string | null;
  active: boolean;
  removedAt: Date_ | null;
  lastSyncedAt: Date_;
  approachId: string | null;
}

const HEALTH: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }
> = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  DEGRADED: { label: 'Com problema', variant: 'warning' },
  ERROR: { label: 'Parado', variant: 'destructive' },
  UNKNOWN: { label: 'Não verificado', variant: 'muted' },
};

const usd = (value: number) =>
  `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

function Connection({ overview }: { overview: WhatsappOverviewView }) {
  const { run, notice, busy } = useAction();
  const config = (overview.connection?.config ?? {}) as Record<string, string | null>;
  const health = HEALTH[overview.connection?.status ?? 'UNKNOWN'] ?? HEALTH.UNKNOWN!;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Número na Meta</CardTitle>
          <CardDescription>
            Qualidade, limite e situação do número, verificados de hora em hora e quando a Meta
            avisa uma mudança.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () => api('/whatsapp/health/check', { method: 'POST', body: {} }),
              'Situação atualizada.',
            )
          }
        >
          <RefreshCw /> Verificar agora
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant={health.variant}>{health.label}</Badge>
          {overview.provider === 'fake' ? <Badge variant="warning">Simulado</Badge> : null}
          <span className="text-muted-foreground">
            Última verificação: {formatDateTime(overview.connection?.lastCheckAt)}
          </span>
        </p>
        <dl className="grid grid-cols-[10rem_1fr] gap-1">
          <dt className="text-muted-foreground">Número</dt>
          <dd>{config.displayPhoneNumber ?? '—'}</dd>
          <dt className="text-muted-foreground">Nome verificado</dt>
          <dd>{config.verifiedName ?? '—'}</dd>
          <dt className="text-muted-foreground">Qualidade</dt>
          <dd>{config.qualityRating ?? '—'}</dd>
          <dt className="text-muted-foreground">Limite (fora da janela)</dt>
          <dd>{config.messagingLimit ?? '—'}</dd>
          <dt className="text-muted-foreground">Situação</dt>
          <dd>{config.status ?? '—'}</dd>
        </dl>
        {overview.connection?.lastError ? (
          <Alert variant="error">{overview.connection.lastError}</Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Month({ overview }: { overview: WhatsappOverviewView }) {
  const t = overview.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Envios pela API em {overview.month}</CardTitle>
        <CardDescription>
          Custo estimado pela categoria que a Meta informa em cada status; a fatura da Meta é a
          fonte oficial.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3" aria-label="Totais do mês">
          {[
            ['Pedidos', String(t.requested)],
            ['Aceitos pela Meta', `${t.accepted} (${pct(t.accepted, t.requested)})`],
            ['Entregues', `${t.delivered} (${pct(t.delivered, t.accepted)})`],
            ['Lidas', `${t.read} (${pct(t.read, t.delivered)})`],
            ['Falharam', String(t.failed)],
            ['Custo estimado', usd(t.costUsd)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {overview.byCategory.length > 0 ? (
          <Table>
            <THead>
              <Tr>
                <Th>Categoria</Th>
                <Th className="text-right">Mensagens</Th>
                <Th className="text-right">Custo estimado</Th>
              </Tr>
            </THead>
            <TBody>
              {overview.byCategory.map((c) => (
                <Tr key={c.category}>
                  <Td>{c.category}</Td>
                  <Td className="text-right tabular-nums">{c.count}</Td>
                  <Td className="text-right tabular-nums">{usd(c.costUsd)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
        {overview.failures.length > 0 ? (
          <div>
            <p className="mb-1 font-medium">Falhas mais comuns</p>
            <ul className="space-y-1">
              {overview.failures.map((f) => (
                <li key={f.code}>
                  <span className="tabular-nums">{f.count}×</span> {f.message}{' '}
                  <span className="text-xs text-muted-foreground">({f.code})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Templates({
  templates,
  approaches,
  enabled,
}: {
  templates: WhatsappTemplateRow[];
  approaches: { id: string; name: string }[];
  enabled: boolean;
}) {
  const { run, notice, busy } = useAction();
  const update = (id: string, body: object) =>
    run(() => api(`/whatsapp/templates/${id}`, { method: 'PATCH', body }), 'Modelo atualizado.');
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Modelos aprovados (templates)</CardTitle>
          <CardDescription>
            Criados e aprovados no WhatsApp Manager da Meta; aqui ficam o espelho, a abordagem de
            cada um (para os relatórios) e se os SDRs podem usá-lo. Sincronizados todo dia.
          </CardDescription>
        </div>
        {enabled ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api<{ created: number; updated: number; removed: number }>(
                    '/whatsapp/templates/sync',
                    { method: 'POST', body: {} },
                  ),
                (r) =>
                  `Modelos sincronizados: ${r.created} novos, ${r.updated} atualizados, ${r.removed} removidos da conta.`,
              )
            }
          >
            <RefreshCw /> Sincronizar com a Meta
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum modelo sincronizado.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Modelo</Th>
                <Th>Situação</Th>
                <Th>Abordagem</Th>
                <Th>Liberado</Th>
              </Tr>
            </THead>
            <TBody>
              {templates.map((t) => (
                <Tr key={t.id} data-testid="whatsapp-template">
                  <Td>
                    <span className="font-medium">{t.name}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {t.language} · {t.categoryLabel}
                    </span>
                    {!t.supported ? (
                      <span className="block text-xs text-muted-foreground">
                        {t.unsupportedReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {t.removedAt ? (
                      <Badge variant="muted">Removido da conta</Badge>
                    ) : (
                      <Badge
                        variant={
                          t.status === 'APPROVED'
                            ? 'success'
                            : t.status === 'PENDING'
                              ? 'muted'
                              : 'warning'
                        }
                      >
                        {t.statusLabel}
                      </Badge>
                    )}
                    {t.qualityScore && t.qualityScore !== 'UNKNOWN' ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        qualidade {t.qualityScore}
                      </span>
                    ) : null}
                    {t.rejectedReason ? (
                      <span className="block text-xs text-muted-foreground">
                        {t.rejectedReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Abordagem do modelo ${t.name}`}
                      className="h-8 text-xs"
                      value={t.approachId ?? ''}
                      disabled={busy}
                      onChange={(e) => update(t.id, { approachId: e.target.value || null })}
                    >
                      <option value="">Sem abordagem</option>
                      {approaches.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Liberar o modelo ${t.name} para os SDRs`}
                      checked={t.active && t.supported && !t.removedAt}
                      disabled={busy || !t.supported || Boolean(t.removedAt)}
                      onChange={(e) => update(t.id, { active: e.target.checked })}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsForm({ initial }: { initial: WhatsappOverviewView['settings'] }) {
  const { run, notice, busy } = useAction();
  const [prices, setPrices] = useState(initial.pricesUsd);
  const [autoSuggest, setAutoSuggest] = useState(initial.autoSuggestClassification);
  const LABELS = {
    marketing: 'Marketing',
    utility: 'Utilidade',
    authentication: 'Autenticação',
    service: 'Atendimento (resposta na janela)',
  } as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preços e automação</CardTitle>
        <CardDescription>
          Preço estimado por mensagem cobrada, em US$, por categoria (confira a tabela da Meta para
          o Brasil). A sugestão automática pede à IA uma classificação para cada resposta: a pessoa
          confirma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
            <Field key={key} label={LABELS[key]} htmlFor={`price-${key}`}>
              <Input
                id={`price-${key}`}
                type="number"
                min={0}
                max={1}
                step="0.0001"
                value={prices[key]}
                onChange={(e) => setPrices({ ...prices, [key]: Number(e.target.value) })}
              />
            </Field>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoSuggest}
            onChange={(e) => setAutoSuggest(e.target.checked)}
          />
          Sugerir a classificação com a IA assim que uma resposta chegar
        </label>
        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api('/whatsapp/settings', {
                    method: 'PUT',
                    body: { pricesUsd: prices, autoSuggestClassification: autoSuggest },
                  }),
                'Configuração salva.',
              )
            }
          >
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Configuração do WhatsApp pela API (ADMIN): número, mês, modelos, preços e automação. */
export function WhatsappSettings({
  overview,
  templates,
  approaches,
}: {
  overview: WhatsappOverviewView;
  templates: WhatsappTemplateRow[];
  approaches: { id: string; name: string }[];
}) {
  const enabled = overview.provider !== null;
  return (
    <div className="space-y-4">
      {!enabled ? (
        <Alert title="WhatsApp pela API desligado (modo assistido)">
          Para ligar: conta Meta Business verificada, número registrado na Cloud API, modelos
          aprovados e as variáveis WHATSAPP_PROVIDER=meta_cloud, META_* e WHATSAPP_* no ambiente
          (docs/INTEGRATIONS.md §16). Fora de produção, envios reais exigem ALLOW_REAL_SENDS=true.
        </Alert>
      ) : null}
      {overview.pendingUnmatched > 0 ? (
        <Alert title="Mensagens de números sem lead">
          {overview.pendingUnmatched} aguardando decisão em{' '}
          <Link href="/conversas?aba=sem-lead" className="underline">
            Conversas
          </Link>
          .
        </Alert>
      ) : null}
      {enabled ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Connection overview={overview} />
          <Month overview={overview} />
        </div>
      ) : null}
      <Templates templates={templates} approaches={approaches} enabled={enabled} />
      <SettingsForm initial={overview.settings} />
    </div>
  );
}
