'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

type Date_ = string | Date;

export interface InstagramSettingsValues {
  discoveryEnabled: boolean;
  discoveryPerHour: number;
  refreshDays: number;
  autoSuggestClassification: boolean;
}

export interface InstagramOverviewView {
  provider: string | null;
  month: string;
  connection: {
    status: string;
    config: unknown;
    lastCheckAt: Date_ | null;
    lastError: string | null;
  } | null;
  settings: InstagramSettingsValues;
  pendingUnmatched: number;
  totals: {
    requested: number;
    accepted: number;
    read: number;
    failed: number;
    received: number;
    comments: number;
  };
  discovery: { found: number; notFound: number; errors: number; lastCheckAt: Date_ | null };
  failures: { code: string; count: number; message: string }[];
}

const HEALTH: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }
> = {
  ACTIVE: { label: 'Ativa', variant: 'success' },
  DEGRADED: { label: 'Com problema', variant: 'warning' },
  ERROR: { label: 'Parada', variant: 'destructive' },
  UNKNOWN: { label: 'Não verificada', variant: 'muted' },
};

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

function Account({ overview }: { overview: InstagramOverviewView }) {
  const { run, notice, busy } = useAction();
  const config = (overview.connection?.config ?? {}) as Record<string, string | number | null>;
  const health = HEALTH[overview.connection?.status ?? 'UNKNOWN'] ?? HEALTH.UNKNOWN!;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Conta profissional</CardTitle>
          <CardDescription>
            Conta do Instagram da Docline ligada à Página do Facebook. O acesso é conferido todo dia
            e quando um envio é recusado por permissão.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () => api('/instagram/account/check', { method: 'POST', body: {} }),
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
          <dt className="text-muted-foreground">Conta</dt>
          <dd>{config.username ? `@${config.username}` : '—'}</dd>
          <dt className="text-muted-foreground">Nome</dt>
          <dd>{config.name ?? '—'}</dd>
          <dt className="text-muted-foreground">Seguidores</dt>
          <dd>{config.followersCount ?? '—'}</dd>
        </dl>
        {overview.connection?.lastError ? (
          <Alert variant="error">{overview.connection.lastError}</Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Month({ overview }: { overview: InstagramOverviewView }) {
  const t = overview.totals;
  const d = overview.discovery;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram em {overview.month}</CardTitle>
        <CardDescription>
          Pela API só se responde: a quem escreveu (até 24 h) e, em particular, a quem comentou (até
          7 dias). O primeiro contato continua pelo app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3" aria-label="Totais do mês">
          {[
            ['Mensagens recebidas', String(t.received)],
            ['Comentários de leads', String(t.comments)],
            ['Respostas pedidas', String(t.requested)],
            ['Aceitas pela Meta', `${t.accepted} (${pct(t.accepted, t.requested)})`],
            ['Lidas', `${t.read} (${pct(t.read, t.accepted)})`],
            ['Falharam', String(t.failed)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground" data-testid="instagram-discovery-summary">
          Perfis consultados: {d.found} com métricas, {d.notFound} sem conta profissional
          {d.errors ? `, ${d.errors} com falha na última consulta` : ''}. Última consulta:{' '}
          {formatDateTime(d.lastCheckAt)}.
        </p>
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

function SettingsForm({ initial }: { initial: InstagramSettingsValues }) {
  const { run, notice, busy } = useAction();
  const [values, setValues] = useState(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Consulta de perfis e automação</CardTitle>
        <CardDescription>
          A consulta de perfis (Business Discovery, da Meta) lê só os números públicos de contas
          profissionais: seguidores, publicações e a data da última. Ela alimenta o critério
          &ldquo;Instagram ativo&rdquo; do score, que fica desligado até você ligá-lo em{' '}
          <Link href="/configuracoes/score" className="underline">
            Score
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.discoveryEnabled}
            onChange={(e) => setValues({ ...values, discoveryEnabled: e.target.checked })}
          />
          Consultar as métricas públicas dos perfis dos leads
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Consultas por hora (máximo)"
            htmlFor="igPerHour"
            hint="A Meta limita as chamadas da conta; deixe folga para as mensagens."
          >
            <Input
              id="igPerHour"
              type="number"
              min={1}
              max={200}
              value={values.discoveryPerHour}
              onChange={(e) => setValues({ ...values, discoveryPerHour: Number(e.target.value) })}
            />
          </Field>
          <Field label="Consultar de novo depois de (dias)" htmlFor="igRefreshDays">
            <Input
              id="igRefreshDays"
              type="number"
              min={7}
              max={180}
              value={values.refreshDays}
              onChange={(e) => setValues({ ...values, refreshDays: Number(e.target.value) })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.autoSuggestClassification}
            onChange={(e) => setValues({ ...values, autoSuggestClassification: e.target.checked })}
          />
          Sugerir a classificação com a IA assim que uma mensagem chegar
        </label>
        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() =>
              run(
                () => api('/instagram/settings', { method: 'PUT', body: values }),
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

/** Configuração do Instagram pela API (ADMIN): conta, mês, consulta de perfis e automação. */
export function InstagramSettings({ overview }: { overview: InstagramOverviewView }) {
  const enabled = overview.provider !== null;
  return (
    <div className="space-y-4">
      {!enabled ? (
        <Alert title="Instagram pela API desligado (modo assistido)">
          Para ligar: conta profissional do Instagram ligada a uma Página, app da Meta com as
          permissões aprovadas no App Review e as variáveis INSTAGRAM_PROVIDER=meta_graph,
          INSTAGRAM_*, FACEBOOK_PAGE_ID e META_* no ambiente (docs/INTEGRATIONS.md §16). Fora de
          produção, envios reais exigem ALLOW_REAL_SENDS=true.
        </Alert>
      ) : null}
      {overview.pendingUnmatched > 0 ? (
        <Alert title="Mensagens de quem não é lead">
          {overview.pendingUnmatched} aguardando decisão em{' '}
          <Link href="/conversas?canal=instagram&aba=sem-lead" className="underline">
            Conversas
          </Link>
          .
        </Alert>
      ) : null}
      {enabled ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Account overview={overview} />
          <Month overview={overview} />
        </div>
      ) : null}
      <SettingsForm initial={overview.settings} />
    </div>
  );
}
