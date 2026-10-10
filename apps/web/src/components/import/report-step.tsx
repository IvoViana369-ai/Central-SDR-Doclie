'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface ReportStats {
  created: number;
  linked: number;
  updated: number;
  skipped: number;
  errors: number;
  suppressed: number;
  invalid: number;
  duplicatesFlagged: number;
}

interface Report {
  batch: { stats: unknown; completedAt: string | Date | null };
  errorRows: { id: string; rowNumber: number; error: string | null }[];
}

const ITEMS: { key: keyof ReportStats; label: string }[] = [
  { key: 'created', label: 'Leads criados' },
  { key: 'linked', label: 'Origem registrada em lead existente' },
  { key: 'updated', label: 'Leads existentes completados' },
  { key: 'skipped', label: 'Linhas puladas' },
  { key: 'suppressed', label: 'Na Lista Não Contatar' },
  { key: 'invalid', label: 'Inválidas (sem nome)' },
  { key: 'duplicatesFlagged', label: 'Possíveis duplicados para revisar' },
  { key: 'errors', label: 'Linhas com erro' },
];

/** Etapa 4: relatório final da importação (F3-06). */
export function ReportStep({ batchId }: { batchId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Report>(`/imports/${batchId}/report`)
      .then(setReport)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o relatório.'),
      );
  }, [batchId]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!report) return <p className="text-sm text-muted-foreground">Carregando o relatório…</p>;
  const stats = report.batch.stats as ReportStats;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Importação concluída</CardTitle>
          <CardDescription>
            Concluída em {formatDateTime(report.batch.completedAt)}. As linhas da planilha ficam
            guardadas por 30 dias para consulta e depois são apagadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ITEMS.map((item) => (
              <div key={item.key} className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {(stats[item.key] ?? 0).toLocaleString('pt-BR')}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/leads">Ver leads</Link>
            </Button>
            {stats.duplicatesFlagged > 0 ? (
              <Button variant="outline" asChild>
                <Link href="/duplicados">Revisar duplicados</Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/importar">Nova importação</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {report.errorRows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Linhas com erro</CardTitle>
            <CardDescription>
              Estas linhas não foram gravadas; as demais seguiram normalmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th className="w-20">Linha</Th>
                  <Th>Motivo</Th>
                </Tr>
              </THead>
              <TBody>
                {report.errorRows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="tabular-nums">{row.rowNumber}</Td>
                    <Td>{row.error ?? 'Erro ao gravar a linha.'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
