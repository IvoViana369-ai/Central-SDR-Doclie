'use client';

import {
  CAMPAIGN_LEAD_STATUS_LABELS,
  INELIGIBILITY_REASON_LABELS,
  INELIGIBILITY_REASONS,
} from '@docline/core/campaigns-domain';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

type LeadStatus = keyof typeof CAMPAIGN_LEAD_STATUS_LABELS;
type Reason = keyof typeof INELIGIBILITY_REASON_LABELS;

interface CampaignLeadRow {
  leadId: string;
  eligibility: 'ELIGIBLE' | 'INELIGIBLE';
  ineligibilityReasons: string[];
  status: LeadStatus;
  releasedAt: string | null;
  contactedAt: string | null;
  repliedAt: string | null;
  interestedAt: string | null;
  opportunityAt: string | null;
  convertedAt: string | null;
  optedOutAt: string | null;
  assignedTo: { id: string; name: string } | null;
  variant: { id: string; label: string; approach: { name: string } } | null;
  lead: {
    code: number;
    displayName: string;
    stateUf: string | null;
    municipality: { name: string } | null;
    stage: { name: string } | null;
  };
}

interface Page {
  items: CampaignLeadRow[];
  total: number;
  nextCursor: string | null;
}

const STATUS_VARIANT: Record<LeadStatus, 'default' | 'muted' | 'success' | 'warning'> = {
  PENDING: 'default',
  RELEASED: 'success',
  SKIPPED: 'warning',
  REMOVED: 'muted',
};

/** O marco mais adiantado do lead no funil. */
function progress(row: CampaignLeadRow): string {
  if (row.optedOutAt) return 'Pediu para sair';
  if (row.convertedAt) return 'Convertido';
  if (row.opportunityAt) return 'Oportunidade';
  if (row.interestedAt) return 'Interessado';
  if (row.repliedAt) return 'Respondeu';
  if (row.contactedAt) return 'Contatado';
  return '—';
}

export function CampaignLeads({
  campaignId,
  sdrs,
  variants,
  canRemove,
}: {
  campaignId: string;
  sdrs: { id: string; name: string }[];
  variants: { id: string; label: string }[];
  /** Retirar quem aguarda liberação (campanha pronta, ativa ou pausada). */
  canRemove: boolean;
}) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [sdr, setSdr] = useState('');
  const [variant, setVariant] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (reason) params.set('reason', reason);
      if (sdr) params.set('assignedToId', sdr);
      if (variant) params.set('variantId', variant);
      if (cursor) params.set('cursor', cursor);
      return api<Page>(`/campaigns/${campaignId}/leads?${params.toString()}`);
    },
    [campaignId, status, reason, sdr, variant],
  );

  useEffect(() => {
    let cancelled = false;
    query()
      .then((result) => {
        if (!cancelled) {
          setPage(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os leads.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function more() {
    if (!page?.nextCursor) return;
    setBusy(true);
    try {
      const next = await query(page.nextCursor);
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar mais.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(leadId: string) {
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/leads/${leadId}/remove`, { method: 'POST', body: {} });
      setPage(
        page && {
          ...page,
          items: page.items.map((r) => (r.leadId === leadId ? { ...r, status: 'REMOVED' } : r)),
        },
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível retirar o lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Leads da campanha{page ? ` (${page.total.toLocaleString('pt-BR')})` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Qualquer situação</option>
            {Object.entries(CAMPAIGN_LEAD_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select aria-label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Qualquer motivo</option>
            {INELIGIBILITY_REASONS.map((r) => (
              <option key={r} value={r}>
                {INELIGIBILITY_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
          <Select aria-label="SDR" value={sdr} onChange={(e) => setSdr(e.target.value)}>
            <option value="">Todos os SDRs</option>
            {sdrs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Variante"
            value={variant}
            disabled={variants.length === 0}
            onChange={(e) => setVariant(e.target.value)}
          >
            <option value="">Todas as variantes</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                Variante {v.label}
              </option>
            ))}
          </Select>
        </div>
        {error ? <Alert variant="error">{error}</Alert> : null}
        {page && page.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum lead com esses filtros.
          </p>
        ) : null}
        {page && page.items.length > 0 ? (
          <Table>
            <THead>
              <Tr>
                <Th>Lead</Th>
                <Th>Situação</Th>
                <Th>SDR</Th>
                <Th>Variante</Th>
                <Th>Liberado</Th>
                <Th>Avanço</Th>
                {canRemove ? <Th className="sr-only">Ações</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {page.items.map((row) => (
                <Tr key={row.leadId}>
                  <Td>
                    <Link href={`/leads/${row.leadId}`} className="font-medium hover:underline">
                      {row.lead.displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.lead.municipality
                        ? `${row.lead.municipality.name}/${row.lead.stateUf}`
                        : (row.lead.stateUf ?? '')}
                      {row.lead.stage ? ` · ${row.lead.stage.name}` : ''}
                    </p>
                  </Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {CAMPAIGN_LEAD_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.ineligibilityReasons.length > 0 ? (
                      <ul className="mt-1 text-xs text-muted-foreground">
                        {row.ineligibilityReasons.map((r) => (
                          <li key={r}>{INELIGIBILITY_REASON_LABELS[r as Reason] ?? r}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Td>
                  <Td>{row.assignedTo?.name ?? '—'}</Td>
                  <Td>
                    {row.variant ? `${row.variant.label} · ${row.variant.approach.name}` : '—'}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(row.releasedAt)}</Td>
                  <Td>{progress(row)}</Td>
                  {canRemove ? (
                    <Td className="text-right">
                      {row.status === 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void remove(row.leadId)}
                        >
                          Retirar
                        </Button>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
        {page?.nextCursor ? (
          <div className="flex justify-center">
            <Button variant="outline" disabled={busy} onClick={() => void more()}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
