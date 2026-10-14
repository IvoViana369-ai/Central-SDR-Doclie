import { COMPARISON_LABELS, MIN_SAMPLE, type RateStat } from '@docline/core/analytics-domain';
import { Badge } from '@/components/ui/badge';
import { fmtPct } from './format';

const VARIANT = { ABOVE: 'success', BELOW: 'warning' } as const;

/**
 * Taxa com o intervalo de confiança de 95% embaixo e, quando a faixa inteira
 * fica de um lado da média, o selo "Acima/Abaixo da média" (texto, não só cor).
 * Base pequena: asterisco e sem comparação (docs/SDR-FLOW.md §11).
 */
export function RateValue({ stat, compare = true }: { stat: RateStat; compare?: boolean }) {
  if (stat.rate === null) return <span className="text-muted-foreground">—</span>;
  const { interval, comparison } = stat;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tabular-nums">
        {fmtPct(stat.rate)}
        {stat.smallSample ? (
          <span className="text-muted-foreground" title="Amostra insuficiente">
            *<span className="sr-only"> (amostra insuficiente)</span>
          </span>
        ) : null}
      </span>
      {interval ? (
        <span
          className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          title="Intervalo de confiança de 95%"
        >
          <span className="sr-only">Intervalo de confiança: </span>
          {fmtPct(interval.low)}–{fmtPct(interval.high)}
        </span>
      ) : null}
      {compare && (comparison === 'ABOVE' || comparison === 'BELOW') ? (
        <Badge variant={VARIANT[comparison]}>{COMPARISON_LABELS[comparison]}</Badge>
      ) : null}
    </span>
  );
}

/** Nota de rodapé das tabelas com taxas. */
export function RateFootnote() {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      Abaixo de cada taxa, a faixa provável (intervalo de confiança de 95%). &quot;Acima&quot; ou
      &quot;abaixo da média&quot; só aparece quando a faixa inteira fica de um lado da taxa geral. *
      Amostra insuficiente: menos de {MIN_SAMPLE} primeiros contatos na base; a taxa é mostrada, mas
      não é comparada.
    </p>
  );
}
