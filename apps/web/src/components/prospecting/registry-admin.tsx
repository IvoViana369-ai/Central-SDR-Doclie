'use client';

import {
  REGISTRY_ERROR_LABELS,
  REGISTRY_INGESTION_STATUS_LABELS,
} from '@docline/core/prospecting-domain';
import { Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import type { RegistryOverviewView } from './types';

const numberFormat = new Intl.NumberFormat('pt-BR');

const PROVIDERS: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  receita_open_data: { label: 'Receita Federal (dados abertos)', variant: 'success' },
  fake: { label: 'Simulada (escritórios fictícios)', variant: 'warning' },
};

const STATUS_VARIANT = { RUNNING: 'default', SUCCEEDED: 'success', FAILED: 'destructive' } as const;

const START_MESSAGES: Record<string, string> = {
  started: 'Carga iniciada: o worker baixa e lê os arquivos (pode levar horas com a base real).',
  resumed: 'A carga em andamento foi retomada.',
  up_to_date: 'O mês mais recente já está carregado.',
  not_published: 'A Receita ainda não publicou o mês por completo. Tente mais tarde.',
};

type Ingestion = RegistryOverviewView['ingestions'][number];

function Stats({ ingestion }: { ingestion: Ingestion }) {
  const stats = (ingestion.stats ?? {}) as Partial<Record<string, number | boolean>>;
  const done = ((ingestion.progress ?? {}) as { done?: string[] }).done?.length ?? 0;
  if (ingestion.status === 'RUNNING') {
    return (
      <span className="text-xs">
        {done} {done === 1 ? 'arquivo lido' : 'arquivos lidos'} ·{' '}
        {numberFormat.format(Number(stats.kept ?? 0))} escritórios até agora
      </span>
    );
  }
  if (ingestion.status !== 'SUCCEEDED') return null;
  return (
    <span className="text-xs">
      {numberFormat.format(Number(stats.total ?? 0))} guardados ·{' '}
      {numberFormat.format(Number(stats.removed ?? 0))} saíram
      {stats.removalSkipped ? ' · queda grande demais: nada foi apagado' : ''}
      {Number(stats.invalid ?? 0) > 0
        ? ` · ${numberFormat.format(Number(stats.invalid))} linhas fora do layout`
        : ''}
    </span>
  );
}

/** Base aberta do CNPJ (ADMIN): fonte, cargas, o que está guardado e a configuração. */
export function RegistryAdmin({ overview }: { overview: RegistryOverviewView }) {
  const { run, notice, busy } = useAction();
  const [settings, setSettings] = useState(overview.settings);
  const provider = overview.provider ? PROVIDERS[overview.provider] : null;
  const dirty = JSON.stringify(settings) !== JSON.stringify(overview.settings);
  const start = (force: boolean) =>
    run(
      () =>
        api<{ status: string }>('/registry/ingestions', {
          method: 'POST',
          body: { force },
        }),
      (r) => START_MESSAGES[r.status] ?? 'Pedido registrado.',
    );

  return (
    <div className="space-y-4">
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Fonte e carga</CardTitle>
          <CardDescription>
            Arquivos abertos publicados pela Receita Federal todo mês. Só os estabelecimentos ativos
            de contabilidade (CNAE 6920-6/01 e 6920-6/02) ficam guardados, separados dos leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Fonte</dt>
              <dd className="mt-1">
                {provider ? (
                  <Badge variant={provider.variant}>{provider.label}</Badge>
                ) : (
                  <Badge variant="muted">Desligada</Badge>
                )}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Mês carregado</dt>
              <dd className="mt-1 font-medium" data-testid="registry-current">
                {overview.current
                  ? `${overview.current.reference} (em ${formatDateTime(overview.current.finishedAt)})`
                  : 'Nenhum'}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Escritórios guardados</dt>
              <dd className="mt-1 font-medium">
                {numberFormat.format(overview.total)}
                {overview.individuals > 0
                  ? ` (${numberFormat.format(overview.individuals)} empresários individuais)`
                  : ''}
              </dd>
            </div>
          </dl>
          {overview.byUf.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {overview.byUf.map((g) => `${g.uf}: ${numberFormat.format(g.count)}`).join(' · ')}
            </p>
          ) : null}
          {!overview.provider ? (
            <Alert>
              A fonte está desligada neste ambiente (COMPANY_REGISTRY_PROVIDER=disabled). A busca
              continua funcionando com o que já foi carregado.
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !overview.provider} onClick={() => start(false)}>
              <Play /> Rodar a carga agora
            </Button>
            <Button
              variant="outline"
              disabled={busy || !overview.provider || !overview.current}
              onClick={() => start(true)}
            >
              <RefreshCw /> Carregar o mês de novo
            </Button>
          </div>
          {overview.ingestions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Mês</Th>
                    <Th>Situação</Th>
                    <Th>Início</Th>
                    <Th>Fim</Th>
                    <Th>Resultado</Th>
                  </Tr>
                </THead>
                <TBody>
                  {overview.ingestions.map((i) => (
                    <Tr key={i.id} data-testid="registry-ingestion">
                      <Td className="font-medium">{i.reference}</Td>
                      <Td>
                        <Badge variant={STATUS_VARIANT[i.status]}>
                          {REGISTRY_INGESTION_STATUS_LABELS[i.status]}
                        </Badge>
                        {i.error ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {REGISTRY_ERROR_LABELS[i.error] ?? i.error}
                          </p>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {formatDateTime(i.startedAt)}
                        {i.requestedBy ? (
                          <p className="text-muted-foreground">{i.requestedBy}</p>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {i.finishedAt ? formatDateTime(i.finishedAt) : '—'}
                      </Td>
                      <Td>
                        <Stats ingestion={i} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>Vale a partir da próxima carga.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.monthlyIngestion}
              onChange={(e) => setSettings({ ...settings, monthlyIngestion: e.target.checked })}
            />
            <span>
              Carga automática todo mês
              <span className="block text-xs text-muted-foreground">
                O worker confere todo dia se a Receita publicou um mês novo e completo.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.includeSecondaryCnae}
              onChange={(e) => setSettings({ ...settings, includeSecondaryCnae: e.target.checked })}
            />
            <span>
              Incluir quem tem a contabilidade só como atividade secundária
              <span className="block text-xs text-muted-foreground">
                Amplia a busca com empresas de outra atividade principal.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.includeIndividualEntrepreneurs}
              onChange={(e) =>
                setSettings({ ...settings, includeIndividualEntrepreneurs: e.target.checked })
              }
            />
            <span>
              Incluir empresários individuais (inclusive MEI)
              <span className="block text-xs text-muted-foreground">
                Os dados desses CNPJs são de uma pessoa (LGPD). Deixe desligado até o parecer
                jurídico (docs/LGPD.md §20, item 6).
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <Button
              disabled={busy || !dirty}
              onClick={() =>
                run(
                  () => api('/registry/settings', { method: 'PUT', body: settings }),
                  'Configuração salva. Vale a partir da próxima carga.',
                )
              }
            >
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
