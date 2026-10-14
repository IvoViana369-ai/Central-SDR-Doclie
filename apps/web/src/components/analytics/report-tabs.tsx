import Link from 'next/link';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/relatorios', label: 'Visão geral', period: true },
  { href: '/relatorios/conversao', label: 'Conversão', period: true },
  { href: '/relatorios/sdr', label: 'Por SDR', period: true },
  { href: '/relatorios/mensal', label: 'Evolução mensal', period: false },
  { href: '/relatorios/canais', label: 'Canais', period: true },
  { href: '/relatorios/ia', label: 'Uso e custos da IA', period: false },
] as const;

/** Abas dos relatórios; as de período levam junto o período escolhido (?de=&ate=). */
export function ReportTabs({
  active,
  period,
}: {
  active: (typeof TABS)[number]['href'];
  period?: { from: string; to: string };
}) {
  return (
    <nav aria-label="Relatórios" className="mb-6 flex flex-wrap gap-1 border-b">
      {TABS.map((tab) => {
        const query = tab.period && period ? `?de=${period.from}&ate=${period.to}` : '';
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors hover:text-foreground',
              current
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
