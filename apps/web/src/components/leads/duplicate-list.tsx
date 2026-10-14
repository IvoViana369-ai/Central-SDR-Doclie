import Link from 'next/link';
import { Alert } from '@/components/ui/alert';

export interface DuplicateMatch {
  code: string;
  status: string;
  inScope: boolean;
  leadId: string | null;
  displayName: string | null;
  city: string | null;
  stateUf: string | null;
  ownerName: string | null;
  reasons: { kind: string; detail: string; blocking: boolean }[];
}

/** Lista de possíveis duplicados (MVP M02: avisa antes de salvar). */
export function DuplicateList({
  duplicates,
  title = 'Encontramos leads parecidos',
}: {
  duplicates: DuplicateMatch[];
  title?: string;
}) {
  const blocking = duplicates.some((d) => d.reasons.some((r) => r.blocking));
  return (
    <Alert variant={blocking ? 'error' : 'info'} title={title}>
      <ul className="mt-1 space-y-1.5">
        {duplicates.map((d) => (
          <li key={d.code}>
            {d.inScope && d.leadId ? (
              <Link href={`/leads/${d.leadId}`} className="font-medium underline" target="_blank">
                {d.code} · {d.displayName}
              </Link>
            ) : (
              <span className="font-medium">{d.code} · lead de outro responsável</span>
            )}
            {d.city ? (
              <span className="text-muted-foreground">
                {' '}
                — {d.city}/{d.stateUf}
              </span>
            ) : null}
            {d.status === 'ARCHIVED' ? (
              <span className="text-muted-foreground"> (arquivado)</span>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              {d.reasons.map((r) => r.detail).join(' · ')}
              {d.ownerName ? ` · responsável: ${d.ownerName}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {blocking ? (
        <p className="mt-2 text-xs">
          CNPJ repetido não pode ser cadastrado de novo: abra o lead existente (ou reative-o, se
          estiver arquivado).
        </p>
      ) : null}
    </Alert>
  );
}
