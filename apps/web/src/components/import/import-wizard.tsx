'use client';

import { IMPORT_STATUS_LABELS } from '@docline/core/import-domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { statusVariant } from './import-home';
import { MappingStep } from './mapping-step';
import { PreviewStep } from './preview-step';
import { ReportStep } from './report-step';
import type { BatchDetail, ImportOptions, ImportStatus, PreviewStats } from './types';

/** Etapas em que o worker está trabalhando: a tela consulta o andamento. */
const RUNNING: ImportStatus[] = ['UPLOADED', 'PREVIEWING', 'COMMITTING'];
const CANCELABLE: ImportStatus[] = ['UPLOADED', 'MAPPING', 'PREVIEWING', 'PREVIEW_READY', 'FAILED'];
const POLL_MS = 1_500;

function Progress({ label, done, total }: { label: string; done?: number; total?: number }) {
  const percent = total ? Math.min(100, Math.round(((done ?? 0) / total) * 100)) : null;
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <p className="text-sm font-medium" role="status">
          {label}
          {percent !== null ? ` ${percent}%` : '…'}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent ?? 35}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Pode sair desta tela: o processamento continua e a importação fica na lista.
        </p>
      </CardContent>
    </Card>
  );
}

/** Linhas que a gravação vai processar (criar, vincular ou completar). */
function rowsToWrite(batch: BatchDetail): number {
  const byDecision = (batch.stats as PreviewStats | null)?.byDecision ?? {};
  return (
    (byDecision.IMPORT ?? 0) + (byDecision.LINK_EXISTING ?? 0) + (byDecision.UPDATE_EXISTING ?? 0)
  );
}

/** Assistente da importação (M04): mapeamento → prévia → confirmação → relatório. */
export function ImportWizard({
  initial,
  options,
  maxFileMb,
}: {
  initial: BatchDetail;
  options: ImportOptions;
  maxFileMb: number;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState(initial);
  const [editingMapping, setEditingMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBatch(await api<BatchDetail>(`/imports/${initial.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar a importação.');
    }
  }, [initial.id]);

  useEffect(() => {
    if (!RUNNING.includes(batch.status)) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [batch.status, refresh]);

  async function cancel() {
    if (!window.confirm('Cancelar esta importação? As linhas lidas serão descartadas.')) return;
    try {
      await api(`/imports/${batch.id}/cancel`, { method: 'POST' });
      router.push('/importar');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível cancelar.');
    }
  }

  return (
    <>
      <PageHeader
        title={batch.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(batch.status)}>
              {IMPORT_STATUS_LABELS[batch.status]}
            </Badge>
            <span>
              {batch.rowCount.toLocaleString('pt-BR')} linhas · enviado em{' '}
              {formatDateTime(batch.createdAt)} por {batch.createdBy.name}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/importar">Voltar</Link>
            </Button>
            {CANCELABLE.includes(batch.status) ? (
              <Button variant="outline" onClick={cancel}>
                Cancelar importação
              </Button>
            ) : null}
          </>
        }
      />
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {batch.previousImport && batch.status !== 'COMPLETED' ? (
          <Alert variant="error" title="Este arquivo já foi importado">
            Em {formatDateTime(batch.previousImport.completedAt)}, por {batch.previousImport.byName}
            . A prévia mostra o que já existe; nada será duplicado sem a sua decisão.
          </Alert>
        ) : null}

        {batch.status === 'UPLOADED' ? <Progress label="Lendo a planilha" /> : null}
        {batch.status === 'FAILED' ? (
          <Alert variant="error" title="Não foi possível ler o arquivo">
            {batch.error ?? 'Erro ao processar a planilha.'}{' '}
            <Link href="/importar" className="underline">
              Enviar outro arquivo
            </Link>
          </Alert>
        ) : null}
        {batch.status === 'CANCELED' ? (
          <Alert title="Importação cancelada">As linhas lidas foram descartadas.</Alert>
        ) : null}
        {batch.status === 'MAPPING' || (batch.status === 'PREVIEW_READY' && editingMapping) ? (
          <MappingStep
            batch={batch}
            options={options}
            maxFileMb={maxFileMb}
            onConfigured={async () => {
              setEditingMapping(false);
              await refresh();
            }}
            onCancelEdit={editingMapping ? () => setEditingMapping(false) : undefined}
          />
        ) : null}
        {batch.status === 'PREVIEWING' ? (
          <Progress label="Conferindo as linhas" done={batch.progress} total={batch.rowCount} />
        ) : null}
        {batch.status === 'PREVIEW_READY' && !editingMapping ? (
          <PreviewStep
            batch={batch}
            onEditMapping={() => setEditingMapping(true)}
            onChanged={refresh}
          />
        ) : null}
        {batch.status === 'COMMITTING' ? (
          <Progress label="Gravando os leads" done={batch.progress} total={rowsToWrite(batch)} />
        ) : null}
        {batch.status === 'COMPLETED' ? <ReportStep batchId={batch.id} /> : null}
      </div>
    </>
  );
}
