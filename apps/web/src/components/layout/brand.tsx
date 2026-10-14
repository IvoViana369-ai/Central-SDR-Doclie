import { cn } from '@/lib/utils';

export function Brand({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        aria-hidden
      >
        D
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold">Docline SDR</p>
        {subtitle ? <p className="text-[11px] opacity-70">Central de Prospecção</p> : null}
      </div>
    </div>
  );
}
