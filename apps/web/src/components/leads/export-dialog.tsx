'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { apiDownload, ApiError } from '@/lib/api-client';

/**
 * Exportação CSV dos leads do filtro atual (ADMIN/GESTOR). Contatos só quando
 * marcados e nunca os da Lista Não Contatar; tudo fica na auditoria.
 */
export function ExportDialog({
  selection,
  total,
  onDone,
}: {
  selection: { filter?: unknown; q?: string };
  total: number;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const headers = await apiDownload('/exports', {
        method: 'POST',
        body: { ...selection, includeContacts },
      });
      const count = Number(headers.get('x-export-count') ?? 0);
      const omitted = Number(headers.get('x-export-omitted-contacts') ?? 0);
      setOpen(false);
      onDone(
        `${count} lead(s) exportado(s).` +
          (omitted > 0 ? ` ${omitted} contato(s) da Lista Não Contatar ficaram de fora.` : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível exportar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download /> Exportar
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Exportar leads"
        description="Arquivo CSV (abre no Excel) com os leads do filtro atual."
      >
        <div className="space-y-4">
          <p className="text-sm" data-testid="export-total">
            <strong>{total}</strong> lead(s) no filtro atual.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeContacts}
              onChange={(e) => setIncludeContacts(e.target.checked)}
            />
            <span>
              Incluir contatos (telefone, WhatsApp, e-mail e Instagram)
              <span className="block text-muted-foreground">
                Contatos da Lista Não Contatar nunca são exportados.
              </span>
            </span>
          </label>
          <Alert variant="info">
            A exportação fica registrada na auditoria (quem, quando, filtro e quantidade). Limite de
            5 por dia. Use o arquivo só para a prospecção da Docline e apague-o quando não precisar
            mais.
          </Alert>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end">
            <Button disabled={busy || total === 0} onClick={run}>
              <Download /> Baixar CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
