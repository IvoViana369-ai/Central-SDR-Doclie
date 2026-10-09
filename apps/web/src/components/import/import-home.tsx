'use client';

import { IMPORT_STATUS_LABELS } from '@docline/core/import-domain';
import { FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { uploadSpreadsheet } from './upload';

type ImportStatus = keyof typeof IMPORT_STATUS_LABELS;

export interface BatchListItem {
  id: string;
  fileName: string;
  status: ImportStatus;
  rowCount: number;
  stats: unknown;
  createdAt: string | Date;
  completedAt: string | Date | null;
  createdBy: { name: string };
}

export function statusVariant(status: ImportStatus) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'CANCELED') return 'muted' as const;
  return 'default' as const;
}

/** Importação de planilhas (M04): envio do arquivo e lotes recentes. */
export function ImportHome({
  batches,
  limits,
}: {
  batches: BatchListItem[];
  limits: { maxFileMb: number; maxRows: number };
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await uploadSpreadsheet(file, null, limits.maxFileMb);
    setBusy(false);
    if (result.ok) router.push(`/importar/${result.batchId}`);
    else setError(result.message);
  }

  return (
    <>
      <PageHeader
        title="Importar planilha"
        description="CSV ou Excel (.xlsx). Você confere o mapeamento e a prévia antes de gravar qualquer lead."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-4" aria-hidden /> Enviar arquivo
            </CardTitle>
            <CardDescription>
              Até {limits.maxFileMb} MB e {limits.maxRows.toLocaleString('pt-BR')} linhas. Arquivos
              com macro (.xlsm) e .xls antigos não são aceitos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Planilha" htmlFor="import-file" error={error ?? undefined}>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  aria-invalid={Boolean(error)}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setError(null);
                  }}
                />
              </Field>
              <Alert>
                Use só dados obtidos de forma legítima. A origem e a base legal do lote são
                obrigatórias e ficam registradas em cada lead.
              </Alert>
              <Button type="submit" disabled={!file || busy} className="w-full">
                {busy ? 'Enviando…' : 'Enviar e continuar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Importações recentes</CardTitle>
            <CardDescription>
              As linhas de cada importação ficam guardadas por 30 dias para o relatório e depois são
              apagadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Arquivo</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">Linhas</Th>
                    <Th>Enviado</Th>
                  </Tr>
                </THead>
                <TBody>
                  {batches.map((b) => (
                    <Tr key={b.id}>
                      <Td>
                        <Link
                          href={`/importar/${b.id}`}
                          className="flex items-center gap-2 font-medium hover:underline"
                        >
                          <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
                          {b.fileName}
                        </Link>
                      </Td>
                      <Td>
                        <Badge variant={statusVariant(b.status)}>
                          {IMPORT_STATUS_LABELS[b.status]}
                        </Badge>
                      </Td>
                      <Td className="text-right tabular-nums">
                        {b.rowCount.toLocaleString('pt-BR')}
                      </Td>
                      <Td className="text-muted-foreground">
                        {formatDateTime(b.createdAt)} · {b.createdBy.name}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
