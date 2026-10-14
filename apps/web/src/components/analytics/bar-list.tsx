import { fmtInt, fmtPct } from './format';

/**
 * Barras horizontais de uma série só (ex.: leads por etapa). Cada linha traz
 * o nome e o valor em texto, então a leitura não depende da cor; a barra só
 * mostra a proporção.
 */
export function BarList({
  rows,
  label,
  empty = 'Nada para mostrar no período.',
}: {
  rows: { key: string; label: string; value: number; share?: number | null; muted?: boolean }[];
  label: string;
  empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((row) => {
        const width = row.value === 0 ? 0 : Math.max(1, (row.value / max) * 100);
        const share = row.share === undefined ? '' : ` (${fmtPct(row.share ?? null)})`;
        return (
          <li
            key={row.key}
            className="group grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm"
            title={`${row.label}: ${fmtInt(row.value)}${share}`}
          >
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span className="flex items-center gap-2">
              <span className="relative h-3 flex-1">
                <span
                  className={`absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80 ${
                    row.muted ? 'bg-chart-axis' : 'bg-chart-1'
                  }`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums">{fmtInt(row.value)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
