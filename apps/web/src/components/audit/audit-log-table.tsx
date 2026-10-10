'use client';

import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { AUDIT_ACTION_LABELS, auditActionLabel, describeAuditEntry } from './labels';

export interface AuditRow {
  id: string;
  occurredAt: string | Date;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  metadata: unknown;
  ip: string | null;
}

interface Page {
  data: AuditRow[];
  nextCursor: string | null;
}

function describe(row: AuditRow): string {
  return describeAuditEntry(row.changes, row.metadata);
}

function actorLabel(row: AuditRow): string {
  if (row.actorName) return row.actorName;
  if (row.action === 'auth.login_failed') return 'Não autenticado';
  return row.actorType === 'SYSTEM' ? 'Sistema' : '—';
}

export function AuditLogTable({ initial }: { initial: Page }) {
  const [rows, setRows] = useState(initial.data);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean, nextAction = action) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '50' });
    if (nextAction) params.set('action', nextAction);
    if (!reset && cursor) params.set('cursor', cursor);
    try {
      const page = await api<Page>(`/audit-logs?${params}`);
      setRows((current) => (reset ? page.data : [...current, ...page.data]));
      setCursor(page.nextCursor);
    } catch {
      setError('Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="audit-action" className="text-sm text-muted-foreground">
          Ação
        </label>
        <Select
          id="audit-action"
          className="w-56"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            void load(true, e.target.value);
          }}
        >
          <option value="">Todas</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Quando</Th>
              <Th>Quem</Th>
              <Th>Ação</Th>
              <Th className="hidden lg:table-cell">Detalhes</Th>
              <Th className="hidden md:table-cell">IP</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum registro.
                </Td>
              </Tr>
            ) : (
              rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.occurredAt)}
                  </Td>
                  <Td>{actorLabel(row)}</Td>
                  <Td>
                    <Badge
                      variant={
                        row.action === 'access.denied' || row.action === 'auth.login_failed'
                          ? 'destructive'
                          : 'default'
                      }
                    >
                      {auditActionLabel(row.action)}
                    </Badge>
                  </Td>
                  <Td
                    className="hidden max-w-md truncate text-xs text-muted-foreground lg:table-cell"
                    title={describe(row)}
                  >
                    {describe(row) || '—'}
                  </Td>
                  <Td className="hidden text-xs text-muted-foreground md:table-cell">
                    {row.ip ?? '—'}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>
      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => load(false)} disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" /> : null}
            Carregar mais
          </Button>
        </div>
      ) : null}
    </div>
  );
}
