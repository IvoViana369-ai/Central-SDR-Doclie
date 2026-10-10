'use client';

import {
  allowedDecisions,
  DECISION_LABELS,
  MATCH_STATUS_LABELS,
} from '@docline/core/import-domain';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { BatchDetail, MatchStatus, PreviewStats, RowDecision } from './types';

interface PreviewRow {
  id: string;
  rowNumber: number;
  raw: string[];
  normalized: { displayName: string; cityName: string | null; stateUf: string | null } | null;
  errors: { column: string | null; message: string }[];
  warnings: { column: string | null; message: string }[];
  matchStatus: MatchStatus | null;
  matchReasons: { rule: string; detail: string }[];
  matchedLead: { id: string; code: string; displayName: string } | null;
  decision: RowDecision | null;
  allowedDecisions: RowDecision[];
}

const STATUS_ORDER: MatchStatus[] = [
  'NEW',
  'EXISTING',
  'POSSIBLE_DUPLICATE',
  'DUPLICATE_IN_FILE',
  'SUPPRESSED',
  'INVALID',
];

const STATUS_VARIANT: Record<
  MatchStatus,
  'default' | 'success' | 'warning' | 'destructive' | 'muted'
> = {
  NEW: 'success',
  EXISTING: 'default',
  POSSIBLE_DUPLICATE: 'warning',
  DUPLICATE_IN_FILE: 'muted',
  SUPPRESSED: 'destructive',
  INVALID: 'destructive',
};

/** Situações em que faz sentido decidir tudo de uma vez. */
const BULK: MatchStatus[] = ['NEW', 'EXISTING', 'POSSIBLE_DUPLICATE'];

type Filter = { matchStatus?: MatchStatus; withIssues?: boolean };

/** Etapa 3: prévia com a situação de cada linha e a decisão (F3-05, F3-06). */
export function PreviewStep({
  batch,
  onEditMapping,
  onChanged,
}: {
  batch: BatchDetail;
  onEditMapping: () => void;
  onChanged: () => Promise<void>;
}) {
  const stats = (batch.stats as PreviewStats | null) ?? {
    byStatus: {},
    byDecision: {},
    withWarnings: 0,
  };
  const [filter, setFilter] = useState<Filter>({});
  /** Muda depois de cada decisão, para recarregar a primeira página. */
  const [version, setVersion] = useState(0);
  const [page, setPage] = useState<{
    key: string;
    rows: PreviewRow[];
    cursor: number | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [bulk, setBulk] = useState<Partial<Record<MatchStatus, RowDecision>>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(
    (next: Filter, after: number | null) => {
      const params = new URLSearchParams({ limit: '50' });
      if (next.matchStatus) params.set('matchStatus', next.matchStatus);
      if (next.withIssues) params.set('withIssues', 'true');
      if (after !== null) params.set('cursor', String(after));
      return api<{ data: PreviewRow[]; nextCursor: number | null }>(
        `/imports/${batch.id}/preview?${params}`,
      );
    },
    [batch.id],
  );
  const showError = (err: unknown) =>
    setNotice({
      variant: 'error',
      text: err instanceof ApiError ? err.message : 'Não foi possível carregar a prévia.',
    });

  // Primeira página do filtro atual; o estado só muda quando a resposta chega.
  const key = JSON.stringify({ filter, version });
  useEffect(() => {
    let current = true;
    fetchPage(filter, null)
      .then((result) => {
        if (current) setPage({ key, rows: result.data, cursor: result.nextCursor });
      })
      .catch((err: unknown) => {
        if (current) {
          setNotice({
            variant: 'error',
            text: err instanceof ApiError ? err.message : 'Não foi possível carregar a prévia.',
          });
        }
      });
    return () => {
      current = false;
    };
  }, [key, filter, fetchPage]);
  const loading = page?.key !== key;
  const rows = page?.rows ?? [];
  const cursor = loading ? null : (page?.cursor ?? null);

  async function loadMore() {
    if (!page || cursor === null) return;
    setLoadingMore(true);
    try {
      const result = await fetchPage(filter, cursor);
      setPage({ key, rows: [...page.rows, ...result.data], cursor: result.nextCursor });
    } catch (err) {
      showError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ variant: 'success', text: success });
      await onChanged();
      setVersion((v) => v + 1);
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível concluir a operação.',
      });
    } finally {
      setBusy(false);
    }
  }

  const toWrite =
    (stats.byDecision.IMPORT ?? 0) +
    (stats.byDecision.LINK_EXISTING ?? 0) +
    (stats.byDecision.UPDATE_EXISTING ?? 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Prévia</CardTitle>
          <CardDescription>
            Nada foi gravado ainda. Confira a situação das linhas e ajuste as decisões; contatos na
            Lista Não Contatar e linhas sem nome nunca viram lead novo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() =>
                  setFilter((f) => (f.matchStatus === status ? {} : { matchStatus: status }))
                }
                aria-pressed={filter.matchStatus === status}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors hover:bg-muted',
                  filter.matchStatus === status && 'border-primary bg-accent',
                )}
              >
                <p className="text-2xl font-semibold tabular-nums">
                  {(stats.byStatus[status] ?? 0).toLocaleString('pt-BR')}
                </p>
                <p className="text-xs text-muted-foreground">{MATCH_STATUS_LABELS[status]}</p>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(filter.withIssues)}
                onChange={(e) => setFilter((f) => ({ ...f, withIssues: e.target.checked }))}
              />
              Só linhas com avisos ({stats.withWarnings.toLocaleString('pt-BR')})
            </label>
            {filter.matchStatus || filter.withIssues ? (
              <Button variant="link" size="sm" onClick={() => setFilter({})}>
                Limpar filtro
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Decidir de uma vez</p>
            <div className="grid gap-2 lg:grid-cols-3">
              {BULK.filter((s) => (stats.byStatus[s] ?? 0) > 0).map((status) => {
                const choices = allowedDecisions(status, { hasMatch: true, matchedByCnpj: false });
                return (
                  <div key={status} className="flex items-center gap-2">
                    <Select
                      aria-label={`Decisão para todas as linhas "${MATCH_STATUS_LABELS[status]}"`}
                      value={bulk[status] ?? ''}
                      onChange={(e) =>
                        setBulk((b) => ({ ...b, [status]: e.target.value as RowDecision }))
                      }
                    >
                      <option value="">{MATCH_STATUS_LABELS[status]}: escolher…</option>
                      {choices.map((d) => (
                        <option key={d} value={d}>
                          {DECISION_LABELS[d]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bulk[status] || busy}
                      onClick={() =>
                        act(
                          () =>
                            api(`/imports/${batch.id}/decisions`, {
                              method: 'POST',
                              body: { matchStatus: status, decision: bulk[status] },
                            }),
                          'Decisões aplicadas.',
                        )
                      }
                    >
                      Aplicar
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <THead>
              <Tr>
                <Th className="w-16">Linha</Th>
                <Th>Empresa</Th>
                <Th>Situação</Th>
                <Th>Avisos</Th>
                <Th className="min-w-52">Decisão</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="tabular-nums text-muted-foreground">{row.rowNumber}</Td>
                  <Td>
                    <p className="font-medium">
                      {row.normalized?.displayName ?? (row.raw.filter(Boolean).join(' · ') || '—')}
                    </p>
                    {row.normalized?.cityName ? (
                      <p className="text-xs text-muted-foreground">
                        {row.normalized.cityName}
                        {row.normalized.stateUf ? `/${row.normalized.stateUf}` : ''}
                      </p>
                    ) : null}
                  </Td>
                  <Td className="space-y-1">
                    {row.matchStatus ? (
                      <Badge variant={STATUS_VARIANT[row.matchStatus]}>
                        {MATCH_STATUS_LABELS[row.matchStatus]}
                      </Badge>
                    ) : null}
                    {row.matchReasons.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {row.matchReasons.map((r) => r.detail).join('; ')}
                      </p>
                    ) : null}
                    {row.matchedLead ? (
                      <Link
                        href={`/leads/${row.matchedLead.id}`}
                        target="_blank"
                        className="text-xs underline"
                      >
                        {row.matchedLead.code} · {row.matchedLead.displayName}
                      </Link>
                    ) : null}
                  </Td>
                  <Td className="max-w-72 text-xs">
                    {[...row.errors, ...row.warnings].map((issue, i) => (
                      <p
                        key={i}
                        className={
                          i < row.errors.length ? 'text-destructive' : 'text-muted-foreground'
                        }
                      >
                        {issue.column ? `${issue.column}: ` : ''}
                        {issue.message}
                      </p>
                    ))}
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Decisão da linha ${row.rowNumber}`}
                      value={row.decision ?? ''}
                      disabled={busy || row.allowedDecisions.length <= 1}
                      onChange={(e) =>
                        act(
                          () =>
                            api(`/imports/${batch.id}/rows/${row.id}`, {
                              method: 'PATCH',
                              body: { decision: e.target.value },
                            }),
                          `Linha ${row.rowNumber}: ${DECISION_LABELS[e.target.value as RowDecision]}.`,
                        )
                      }
                    >
                      {row.allowedDecisions.map((d) => (
                        <option key={d} value={d}>
                          {DECISION_LABELS[d]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {!loading && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma linha com este filtro.
            </p>
          ) : null}
          {cursor !== null ? (
            <div className="pt-4 text-center">
              <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">
              Ao confirmar: {(stats.byDecision.IMPORT ?? 0).toLocaleString('pt-BR')} leads novos,{' '}
              {(stats.byDecision.LINK_EXISTING ?? 0).toLocaleString('pt-BR')} com a origem
              registrada no existente,{' '}
              {(stats.byDecision.UPDATE_EXISTING ?? 0).toLocaleString('pt-BR')} completados e{' '}
              {(stats.byDecision.SKIP ?? 0).toLocaleString('pt-BR')} pulados.
            </p>
            <p className="text-muted-foreground">
              Possíveis duplicados criados vão para a tela Duplicados; nada é excluído.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onEditMapping} disabled={busy}>
              Ajustar mapeamento
            </Button>
            {confirming ? (
              <>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                  Voltar
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api(`/imports/${batch.id}/commit`, { method: 'POST' }),
                      'Importação confirmada. Gravando…',
                    )
                  }
                >
                  Confirmar e gravar
                </Button>
              </>
            ) : (
              <Button disabled={busy || toWrite === 0} onClick={() => setConfirming(true)}>
                Importar {toWrite.toLocaleString('pt-BR')} linhas
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
