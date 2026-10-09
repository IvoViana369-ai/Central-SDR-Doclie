'use client';

import { useState } from 'react';
import { auditActionLabel, describeAuditEntry } from '@/components/audit/labels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

export interface TimelineEvent {
  id: string;
  type: string;
  label: string;
  occurredAt: string | Date;
  actorName: string | null;
  payload: unknown;
}

export interface TimelinePage {
  data: TimelineEvent[];
  users: Record<string, string>;
  nextCursor: string | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  occurredAt: string | Date;
  actorName: string | null;
  changes: unknown;
  metadata: unknown;
}

const FIELD_NAMES: Record<string, string> = {
  companyName: 'razão social',
  tradeName: 'nome fantasia',
  leadType: 'tipo',
  segmentId: 'segmento',
  category: 'categoria',
  cnpj: 'CNPJ',
  addressLine: 'endereço',
  addressNumber: 'número',
  addressComplement: 'complemento',
  neighborhood: 'bairro',
  cityRaw: 'cidade',
  municipalityCode: 'cidade',
  stateUf: 'UF',
  postalCode: 'CEP',
  websiteUrl: 'site',
  description: 'observações gerais',
};

/** Detalhe curto de um evento, a partir do payload (que não guarda dados pessoais em claro). */
function eventDetail(event: TimelineEvent, users: Record<string, string>): string | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const user = (id: unknown) => (typeof id === 'string' ? (users[id] ?? 'usuário') : 'pool');
  switch (event.type) {
    case 'lead.updated':
      return [...new Set((p.fields as string[] | undefined)?.map((f) => FIELD_NAMES[f] ?? f))].join(
        ', ',
      );
    case 'owner.assigned':
      return `${user(p.fromUserId)} → ${user(p.toUserId)}${p.bulk ? ' (em massa)' : ''}`;
    case 'contact_point.added':
    case 'contact_point.removed':
    case 'contact_point.updated':
      return typeof p.value === 'string' ? p.value : null;
    case 'tag.added':
    case 'tag.removed':
      return typeof p.name === 'string' ? p.name : null;
    case 'optout.registered':
      return [
        p.scope === 'ALL_CHANNELS' ? 'todos os canais' : String(p.scope ?? '').toLowerCase(),
        p.viaLeadCode ? `pelo lead ${String(p.viaLeadCode)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'permission.changed':
      return `${String(p.channel)}: ${String(p.legalBasis)}`;
    case 'lead.archived':
    case 'lead.unarchived':
      return typeof p.reason === 'string' ? p.reason : null;
    default:
      return null;
  }
}

/** Timeline (MVP M09) e histórico de alterações (MVP M02) do lead. */
export function ActivityCard({ leadId, initial }: { leadId: string; initial: TimelinePage }) {
  const [tab, setTab] = useState<'timeline' | 'history'>('timeline');
  const [timeline, setTimeline] = useState(initial);
  const [history, setHistory] = useState<{
    data: HistoryEntry[];
    nextCursor: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTimeline() {
    setLoading(true);
    try {
      const next = await api<TimelinePage>(
        `/leads/${leadId}/timeline?cursor=${timeline.nextCursor}`,
      );
      setTimeline((t) => ({
        data: [...t.data, ...next.data],
        users: { ...t.users, ...next.users },
        nextCursor: next.nextCursor,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(cursor?: string) {
    setLoading(true);
    try {
      const next = await api<{ data: HistoryEntry[]; nextCursor: string | null }>(
        `/leads/${leadId}/history${cursor ? `?cursor=${cursor}` : ''}`,
      );
      setHistory((h) =>
        cursor && h ? { data: [...h.data, ...next.data], nextCursor: next.nextCursor } : next,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Atividade</CardTitle>
        <div role="tablist" aria-label="Atividade do lead" className="flex gap-1">
          {(
            [
              ['timeline', 'Timeline'],
              ['history', 'Histórico de alterações'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
                if (value === 'history' && !history) void loadHistory();
              }}
              className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                tab === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
        {tab === 'timeline' ? (
          <ol className="space-y-3" aria-label="Timeline">
            {timeline.data.map((event) => {
              const detail = eventDetail(event, timeline.users);
              return (
                <li key={event.id} className="border-l-2 pl-3">
                  <p className="text-sm font-medium">{event.label}</p>
                  {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(event.occurredAt)} · {event.actorName ?? 'Sistema'}
                  </p>
                </li>
              );
            })}
            {timeline.nextCursor ? (
              <Button variant="outline" size="sm" disabled={loading} onClick={loadTimeline}>
                Ver mais
              </Button>
            ) : null}
          </ol>
        ) : (
          <ol className="space-y-3" aria-label="Histórico de alterações">
            {history === null ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
            {history?.data.map((entry) => (
              <li key={entry.id} className="border-l-2 pl-3">
                <p className="text-sm font-medium">{auditActionLabel(entry.action)}</p>
                <p className="text-sm text-muted-foreground">
                  {describeAuditEntry(entry.changes, entry.metadata)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.occurredAt)} · {entry.actorName ?? 'Sistema'}
                </p>
              </li>
            ))}
            {history?.nextCursor ? (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => loadHistory(history.nextCursor!)}
              >
                Ver mais
              </Button>
            ) : null}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
