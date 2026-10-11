'use client';

import { KNOWN_SYSTEMS } from '@docline/core/integrations-domain';
import { ExternalLink, Link2 } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

export interface LeadReferenceView {
  id: string;
  system: string;
  systemLabel: string;
  externalId: string;
  url: string | null;
  syncedAt: string | Date;
}

/**
 * Ficha do lead: o id do mesmo escritório no CRM e em outros sistemas Docline
 * (F12-03). Gravados pelo CRM com chave de API ou pelo ADMIN aqui.
 */
export function LeadReferencesCard({
  leadId,
  items,
  canManage,
}: {
  leadId: string;
  items: LeadReferenceView[];
  canManage: boolean;
}) {
  const { run, notice, busy } = useAction();
  const [system, setSystem] = useState('DOCLINE_CRM');
  const [externalId, setExternalId] = useState('');
  if (items.length === 0 && !canManage) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4" aria-hidden /> Outros sistemas Docline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {items.length === 0 ? (
          <p className="text-muted-foreground">Sem vínculo com o CRM ou outros sistemas.</p>
        ) : (
          <ul className="space-y-2" aria-label="Referências externas">
            {items.map((ref) => (
              <li key={ref.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{ref.systemLabel}:</span>{' '}
                  {ref.url ? (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {ref.externalId} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    ref.externalId
                  )}
                  <span className="block text-xs text-muted-foreground">
                    Sincronizado em {formatDateTime(ref.syncedAt)}
                  </span>
                </span>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Desfazer vínculo com ${ref.systemLabel}`}
                    onClick={() => {
                      if (!window.confirm(`Desfazer o vínculo com ${ref.systemLabel}?`)) return;
                      const params = new URLSearchParams({
                        entityType: 'LEAD',
                        entityId: leadId,
                        system: ref.system,
                      });
                      void run(
                        () => api(`/integrations/references?${params}`, { method: 'DELETE' }),
                        'Vínculo desfeito.',
                      );
                    }}
                  >
                    Desfazer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            aria-label="Vincular a outro sistema"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api('/integrations/references', {
                    method: 'PUT',
                    body: { entityType: 'LEAD', entityId: leadId, system, externalId },
                  }),
                'Vínculo gravado.',
              ).then((ok) => {
                if (ok) setExternalId('');
              });
            }}
          >
            <Field label="Sistema" htmlFor="refSystem">
              <Select id="refSystem" value={system} onChange={(e) => setSystem(e.target.value)}>
                {Object.entries(KNOWN_SYSTEMS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Id no sistema" htmlFor="refExternalId">
              <Input
                id="refExternalId"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </Field>
            <Button type="submit" size="sm" disabled={busy || !externalId.trim()}>
              Vincular
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
