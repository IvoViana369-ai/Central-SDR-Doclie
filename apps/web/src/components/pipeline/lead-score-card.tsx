import { Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { ScoreBadge, type ScoreBand } from './pipeline-ui';

export interface LeadScoreView {
  score: number | null;
  band: ScoreBand | null;
  computedAt: string | Date | null;
  model: { version: number; name: string };
  pending: boolean;
  current: { score: number; band: ScoreBand; bandLabel: string };
  breakdown: {
    ruleId: string | null;
    criterion: string;
    label: string;
    matched: boolean;
    points: number;
    weight: number;
    detail: string;
  }[];
  history: {
    id: string;
    score: number;
    bandLabel: string;
    previousScore: number | null;
    triggerLabel: string;
    computedAt: string | Date;
    modelVersion: number;
  }[];
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Score explicado por critério (M07) e o histórico de mudanças. */
export function LeadScoreCard({ score }: { score: LeadScoreView }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Score</CardTitle>
        <ScoreBadge score={score.score} band={score.band} className="text-sm" />
      </CardHeader>
      <CardContent className="space-y-3">
        {score.pending ? (
          <p className="text-xs text-muted-foreground">
            Recalculando: o valor novo é {score.current.score} ({score.current.bandLabel}).
          </p>
        ) : null}
        <ul className="space-y-1.5" aria-label="Critérios do score">
          {score.breakdown.map((item, i) => (
            <li key={item.ruleId ?? i} className="flex items-start justify-between gap-2 text-sm">
              <span className="flex items-start gap-1.5">
                {item.matched ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Atende" />
                ) : (
                  <X
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-label="Não atende"
                  />
                )}
                <span>
                  {item.label}
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
              </span>
              <span
                className={
                  item.matched
                    ? 'shrink-0 font-medium tabular-nums'
                    : 'shrink-0 text-muted-foreground tabular-nums'
                }
              >
                {item.matched ? signed(item.points) : `0 de ${signed(item.weight)}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Modelo v{score.model.version} · calculado em {formatDateTime(score.computedAt)}
        </p>
        {score.history.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Mudanças do score ({score.history.length})
            </summary>
            <ol className="mt-2 space-y-1.5" aria-label="Histórico do score">
              {score.history.map((h) => (
                <li key={h.id} className="text-xs">
                  <span className="font-medium tabular-nums">
                    {h.previousScore === null ? '' : `${h.previousScore} → `}
                    {h.score}
                  </span>{' '}
                  ({h.bandLabel}) · {h.triggerLabel} · {formatDateTime(h.computedAt)}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
