'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

type Action = 'assign' | 'addTag' | 'removeTag';

export type BulkTarget = { ids: string[] } | { mode: 'filter'; filter?: unknown; q?: string };

interface Preview {
  total: number;
  contactable: number;
  blocked: number;
  willChange: number;
  confirmationToken: string;
}

const ACTION_LABELS: Record<Action, string> = {
  assign: 'Atribuir responsável',
  addTag: 'Adicionar tag',
  removeTag: 'Remover tag',
};

/**
 * Ação em massa (MVP M03): primeiro simula e mostra "N selecionados · X
 * contactáveis · Y bloqueados"; só então permite confirmar.
 */
export function BulkDialog({
  open,
  onOpenChange,
  target,
  owners,
  tags,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: BulkTarget;
  owners?: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onDone: (message: string) => void;
}) {
  const [action, setAction] = useState<Action>(owners ? 'assign' : 'addTag');
  const [ownerId, setOwnerId] = useState('');
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params = action === 'assign' ? { ownerId: ownerId || null } : { tagId };

  async function call(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Preview & { changed?: number }>('/leads/bulk', {
        method: 'POST',
        body: {
          action,
          target,
          params,
          dryRun,
          ...(dryRun ? {} : { confirmationToken: preview?.confirmationToken }),
        },
      });
      if (dryRun) {
        setPreview(result);
      } else {
        onDone(`${ACTION_LABELS[action]}: ${result.changed ?? 0} lead(s) alterado(s).`);
        onOpenChange(false);
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
      if (!dryRun) setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPreview(null);
      }}
    >
      <DialogContent title="Ação em massa" description="Simule antes de confirmar.">
        <div className="space-y-4">
          <Field label="Ação" htmlFor="bulkAction">
            <Select
              id="bulkAction"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as Action);
                setPreview(null);
              }}
            >
              {(Object.keys(ACTION_LABELS) as Action[])
                .filter((a) => a !== 'assign' || owners)
                .map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
            </Select>
          </Field>
          {action === 'assign' ? (
            <Field label="Novo responsável" htmlFor="bulkOwner">
              <Select
                id="bulkOwner"
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="">Sem responsável (devolver ao pool)</option>
                {owners?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Tag" htmlFor="bulkTag">
              <Select
                id="bulkTag"
                value={tagId}
                onChange={(e) => {
                  setTagId(e.target.value);
                  setPreview(null);
                }}
              >
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {error ? <Alert variant="error">{error}</Alert> : null}
          {preview ? (
            <Alert variant="info" title="Confira antes de confirmar">
              <p data-testid="bulk-summary">
                {preview.total} leads selecionados · {preview.contactable} contactáveis ·{' '}
                {preview.blocked} bloqueados
              </p>
              <p>{preview.willChange} serão alterados.</p>
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            {preview ? (
              <Button disabled={busy || preview.willChange === 0} onClick={() => call(false)}>
                Confirmar
              </Button>
            ) : (
              <Button disabled={busy || (action !== 'assign' && !tagId)} onClick={() => call(true)}>
                Simular
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
