import { formatDateTime } from '@/lib/utils';

/** Quando os indicadores dos rollups foram atualizados (o worker recalcula de hora em hora). */
export function Freshness({ refreshedAt }: { refreshedAt: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      {refreshedAt
        ? `Atualizado em ${formatDateTime(refreshedAt)}; recalculado de hora em hora.`
        : 'Os indicadores ainda não foram calculados: o worker calcula de hora em hora.'}
    </p>
  );
}
