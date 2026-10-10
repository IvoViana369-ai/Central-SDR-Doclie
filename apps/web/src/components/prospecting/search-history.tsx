import { CNAE_LABELS } from '@docline/core/prospecting-domain';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDateTime, plural } from '@/lib/utils';
import type { ProspectingHistoryItem, SearchParamsView } from './types';

function describe(params: SearchParamsView): string {
  const parts = [params.uf ?? ''];
  if (params.municipalityCodes?.length) {
    parts.push(
      `${params.municipalityCodes.length} ${params.municipalityCodes.length === 1 ? 'cidade' : 'cidades'}`,
    );
  }
  if (params.cnae) parts.push(CNAE_LABELS[params.cnae] ?? params.cnae);
  if (params.name) parts.push(`“${params.name}”`);
  if (params.headOfficeOnly === false) parts.push('com filiais');
  if (params.onlyNew === false) parts.push('incluindo leads');
  return parts.filter(Boolean).join(' · ');
}

/** Últimas buscas (os resultados duram 30 dias; a busca fica no histórico). */
export function SearchHistory({
  searches,
  currentId,
}: {
  searches: ProspectingHistoryItem[];
  currentId: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimas buscas</CardTitle>
      </CardHeader>
      <CardContent>
        {searches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma busca ainda.</p>
        ) : (
          <ul className="divide-y text-sm">
            {searches.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/prospeccao?busca=${s.id}`}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 px-1 py-2 hover:bg-muted/50',
                    s.id === currentId && 'bg-muted',
                  )}
                >
                  <span>
                    <span className="font-medium">{describe(s.params as SearchParamsView)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(s.createdAt)}
                      {s.requestedBy ? ` · ${s.requestedBy}` : ''} · base{' '}
                      {s.datasetReference ?? '—'}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {s.purgedAt ? (
                      <Badge variant="muted">Expirada</Badge>
                    ) : (
                      <>
                        <Badge variant="muted">
                          {plural(s.counts.PENDING, 'pendente', 'pendentes')}
                        </Badge>
                        <Badge variant="success">
                          {plural(s.counts.APPROVED, 'aprovado', 'aprovados')}
                        </Badge>
                        {s.counts.REJECTED ? (
                          <Badge variant="destructive">
                            {plural(s.counts.REJECTED, 'recusado', 'recusados')}
                          </Badge>
                        ) : null}
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
