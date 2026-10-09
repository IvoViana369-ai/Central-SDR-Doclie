import { PERIOD_PRESETS, presetRange, type PeriodPresetKey } from '@docline/core/analytics-domain';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Filtros dos indicadores: atalhos de período primeiro, depois o intervalo e a
 * pessoa. Tudo na URL (?de=&ate=&pessoa=), então funciona sem JavaScript e o
 * link pode ser compartilhado.
 */
export function PeriodFilter({
  basePath,
  from,
  to,
  active,
  now,
  people,
  personId,
}: {
  basePath: string;
  from: string;
  to: string;
  active: PeriodPresetKey | null;
  now: Date;
  /** Só para quem vê a equipe. */
  people?: { id: string; name: string }[];
  personId?: string | null;
}) {
  const href = (range: { from: string; to: string }) => {
    const params = new URLSearchParams({ de: range.from, ate: range.to });
    if (personId) params.set('pessoa', personId);
    return `${basePath}?${params}`;
  };
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <nav aria-label="Período" className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map((preset) => (
          <Link
            key={preset.key}
            href={href(presetRange(preset.key, now))}
            aria-current={active === preset.key ? 'true' : undefined}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted',
              active === preset.key
                ? 'border-primary bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground',
            )}
          >
            {preset.label}
          </Link>
        ))}
      </nav>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          De
          <input
            type="date"
            name="de"
            defaultValue={from}
            required
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Até
          <input
            type="date"
            name="ate"
            defaultValue={to}
            required
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        {people ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Pessoa
            <select
              name="pessoa"
              defaultValue={personId ?? ''}
              className="h-9 max-w-52 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">Toda a equipe</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" variant="outline" size="sm" className="h-9">
          Aplicar
        </Button>
      </form>
    </div>
  );
}
