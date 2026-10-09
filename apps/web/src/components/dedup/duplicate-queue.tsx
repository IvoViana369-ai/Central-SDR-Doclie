'use client';

import { CONFIDENCE_LABELS, RULE_LABELS, type DuplicateRule } from '@docline/core/dedup-domain';
import { Radar } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

type Confidence = keyof typeof CONFIDENCE_LABELS;
type Status = 'PENDING' | 'IGNORED' | 'KEPT_SEPARATE' | 'MERGED';

interface LeadSummary {
  id: string;
  code: string;
  displayName: string;
  city: string | null;
  stateUf: string | null;
  statusLabel: string;
  ownerName: string | null;
}

export interface DuplicateItem {
  id: string;
  score: number;
  confidence: Confidence;
  confidenceLabel: string;
  status: Status;
  statusLabel: string;
  reasons: { rule: string; label: string; detail: string }[];
  detectedAt: string | Date;
  decidedByName: string | null;
  leads: LeadSummary[];
}

export interface DuplicatePage {
  data: DuplicateItem[];
  counts: Record<Confidence, number>;
  nextCursor: number | null;
}

const STATUS_LABELS: Record<Status, string> = {
  PENDING: 'Pendentes',
  IGNORED: 'Ignorados',
  KEPT_SEPARATE: 'Mantidos separados',
  MERGED: 'Mesclados',
};

export function confidenceVariant(confidence: Confidence) {
  return confidence === 'HIGH' ? 'destructive' : confidence === 'MEDIUM' ? 'warning' : 'muted';
}

/** Fila de possíveis duplicados (F3-09): da maior confiança para a menor. */
export function DuplicateQueue({ initial }: { initial: DuplicatePage }) {
  const [filters, setFilters] = useState<{
    status: Status;
    confidence: Confidence | '';
    rule: DuplicateRule | '';
  }>({ status: 'PENDING', confidence: '', rule: '' });
  const [offset, setOffset] = useState(0);
  // A primeira página vem do servidor; as outras, da API quando o filtro muda.
  const key = JSON.stringify({ filters, offset });
  const [page, setPage] = useState({ key, data: initial });
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (page.key === key) return;
    let current = true;
    const params = new URLSearchParams({ status: filters.status, limit: '25' });
    if (filters.confidence) params.set('confidence', filters.confidence);
    if (filters.rule) params.set('rule', filters.rule);
    if (offset) params.set('cursor', String(offset));
    api<DuplicatePage>(`/duplicates?${params}`)
      .then((data) => {
        if (current) setPage({ key, data });
      })
      .catch((err: unknown) => {
        if (current) {
          setNotice({
            variant: 'error',
            text: err instanceof ApiError ? err.message : 'Não foi possível carregar a fila.',
          });
        }
      });
    return () => {
      current = false;
    };
  }, [key, page.key, filters, offset]);
  const loading = page.key !== key;
  const data = page.data;

  const change = (next: Partial<typeof filters>) => {
    setOffset(0);
    setFilters((f) => ({ ...f, ...next }));
  };

  async function scan() {
    setNotice(null);
    try {
      await api('/duplicates/scan', { method: 'POST' });
      setNotice({
        variant: 'success',
        text: 'Varredura agendada. Os pares novos aparecem aqui em alguns minutos.',
      });
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível agendar a varredura.',
      });
    }
  }

  const total = data.counts.HIGH + data.counts.MEDIUM + data.counts.LOW;

  return (
    <>
      <PageHeader
        title="Possíveis duplicados"
        description="Pares encontrados no cadastro, na importação e na varredura diária. Nada é excluído: mesclar reúne tudo num lead só."
        actions={
          <Button variant="outline" onClick={scan}>
            <Radar /> Varrer a base agora
          </Button>
        }
      />
      <div className="space-y-4">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Confiança">
            {(['', 'HIGH', 'MEDIUM', 'LOW'] as const).map((c) => (
              <Button
                key={c || 'all'}
                role="tab"
                aria-selected={filters.confidence === c}
                variant={filters.confidence === c ? 'default' : 'outline'}
                size="sm"
                onClick={() => change({ confidence: c })}
              >
                {c ? CONFIDENCE_LABELS[c] : 'Todas'} (
                {(c ? data.counts[c] : total).toLocaleString('pt-BR')})
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label="Motivo"
              value={filters.rule}
              onChange={(e) => change({ rule: e.target.value as DuplicateRule | '' })}
            >
              <option value="">Todos os motivos</option>
              {(Object.entries(RULE_LABELS) as [DuplicateRule, string][]).map(([rule, label]) => (
                <option key={rule} value={rule}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Situação"
              value={filters.status}
              onChange={(e) => change({ status: e.target.value as Status })}
            >
              {(Object.entries(STATUS_LABELS) as [Status, string][]).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className={cn('overflow-x-auto pt-6', loading && 'opacity-60')}>
            {data.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {filters.status === 'PENDING'
                  ? 'Nenhum possível duplicado pendente.'
                  : 'Nenhum par com este filtro.'}
              </p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Confiança</Th>
                    <Th>Leads</Th>
                    <Th>Motivos</Th>
                    <Th>Encontrado</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {data.data.map((item) => (
                    <Tr key={item.id}>
                      <Td>
                        <Badge variant={confidenceVariant(item.confidence)}>
                          {item.confidenceLabel} · {Math.round(item.score * 100)}%
                        </Badge>
                      </Td>
                      <Td className="space-y-1">
                        {item.leads.map((lead) => (
                          <p key={lead.id} className="text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {lead.code}
                            </span>{' '}
                            <span className="font-medium">{lead.displayName}</span>
                            {lead.city ? (
                              <span className="text-muted-foreground">
                                {' '}
                                · {lead.city}
                                {lead.stateUf ? `/${lead.stateUf}` : ''}
                              </span>
                            ) : null}
                          </p>
                        ))}
                      </Td>
                      <Td className="max-w-72 text-xs">
                        {item.reasons.map((r, i) => (
                          <p key={i}>
                            {r.label}
                            {r.detail ? (
                              <span className="text-muted-foreground"> ({r.detail})</span>
                            ) : null}
                          </p>
                        ))}
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        {formatDateTime(item.detectedAt)}
                        {item.status !== 'PENDING' && item.decidedByName
                          ? ` · ${item.statusLabel.toLowerCase()} por ${item.decidedByName}`
                          : ''}
                      </Td>
                      <Td className="text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/duplicados/${item.id}`}>
                            {item.status === 'PENDING' || item.status === 'IGNORED'
                              ? 'Comparar'
                              : 'Ver'}
                          </Link>
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            {offset > 0 || data.nextCursor !== null ? (
              <div className="flex justify-between pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset((o) => Math.max(0, o - 25))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.nextCursor === null || loading}
                  onClick={() => setOffset(data.nextCursor ?? 0)}
                >
                  Próxima
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
