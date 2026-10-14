import { METRIC_KIND_LABELS, METRICS, type MetricKey } from '@docline/core/analytics-domain';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { fmtHours, fmtInt, fmtPct, plural } from './format';

export interface DashboardKpis {
  totalLeads: number;
  newLeads: number;
  contacted: number;
  messagesSent: number;
  contactsLogged: number;
  firstContacts: number;
  responded: number;
  responseRate: number | null;
  interested: number;
  opportunities: number;
  conversions: number;
  partners: number;
  customers: number;
  conversionRate: number | null;
  optOuts: number;
  medianHoursToFirstContact: number | null;
  smallSample: boolean;
}

function Tile({
  metric,
  value,
  detail,
  warning,
}: {
  metric: MetricKey;
  value: string;
  detail?: ReactNode;
  warning?: string | null;
}) {
  const def = METRICS[metric];
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs"
      title={`${def.help} (${METRIC_KIND_LABELS[def.kind]})`}
    >
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        {def.label}
        <Info className="size-3.5 opacity-60" aria-hidden />
      </p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">
        <span className="sr-only">{def.help} </span>
        {detail ?? METRIC_KIND_LABELS[def.kind]}
      </p>
      {warning ? (
        <Badge variant="warning" className="mt-1 self-start">
          {warning}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * Indicadores do período (M16). As taxas usam a coorte do primeiro contato e
 * avisam quando a base é pequena (docs/SDR-FLOW.md §11).
 */
export function KpiGrid({ kpis }: { kpis: DashboardKpis }) {
  const small = kpis.smallSample ? 'Amostra pequena' : null;
  return (
    <section
      aria-label="Indicadores do período"
      className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
    >
      <Tile metric="totalLeads" value={fmtInt(kpis.totalLeads)} />
      <Tile metric="newLeads" value={fmtInt(kpis.newLeads)} />
      <Tile
        metric="contacted"
        value={fmtInt(kpis.contacted)}
        detail={`${plural(kpis.messagesSent, 'mensagem', 'mensagens')} · ${plural(kpis.contactsLogged, 'contato registrado', 'contatos registrados')}`}
      />
      <Tile
        metric="responseRate"
        value={fmtPct(kpis.responseRate)}
        detail={`${fmtInt(kpis.responded)} de ${fmtInt(kpis.firstContacts)} primeiros contatos`}
        warning={small}
      />
      <Tile metric="interested" value={fmtInt(kpis.interested)} />
      <Tile metric="opportunities" value={fmtInt(kpis.opportunities)} />
      <Tile
        metric="conversions"
        value={fmtInt(kpis.conversions)}
        detail={`${plural(kpis.partners, 'parceiro', 'parceiros')} · ${plural(kpis.customers, 'cliente', 'clientes')}`}
      />
      <Tile
        metric="conversionRate"
        value={fmtPct(kpis.conversionRate)}
        detail={`coorte de ${fmtInt(kpis.firstContacts)} primeiros contatos`}
        warning={small}
      />
      <Tile metric="optOuts" value={fmtInt(kpis.optOuts)} />
      <Tile
        metric="medianHoursToFirstContact"
        value={fmtHours(kpis.medianHoursToFirstContact)}
        detail="mediana, do cadastro ao 1º contato"
      />
    </section>
  );
}
