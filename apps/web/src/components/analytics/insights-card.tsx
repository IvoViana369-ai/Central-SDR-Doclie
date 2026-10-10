'use client';

import type { InsightsView } from '@docline/core';
import { Lightbulb, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

/**
 * Insights da carteira (F11-04): frases curtas com os números do dia. Os
 * números vêm do banco; o texto pode ter sido redigido pela IA (marcado) e foi
 * conferido. Cada um pode ser avaliado; a gestão pode gerar de novo.
 */
export function InsightsCard({
  view,
  refreshScope,
}: {
  view: InsightsView;
  /** Quem pode gerar de novo: o público do botão "Atualizar". */
  refreshScope: { scope: 'TEAM' | 'USER'; userId?: string } | null;
}) {
  const { run, notice, busy } = useAction();
  const rate = (id: string, feedback: 'USEFUL' | 'NOT_USEFUL') =>
    run(
      () => api(`/insights/${id}/feedback`, { method: 'POST', body: { feedback } }),
      'Obrigado pela avaliação.',
    );
  const refresh = () =>
    refreshScope
      ? run(
          () => api('/insights/refresh', { method: 'POST', body: refreshScope }),
          (r: unknown) => {
            const count = (r as { count: number }).count;
            return count === 0
              ? 'Nada a destacar agora.'
              : `${count} ${count === 1 ? 'insight gerado' : 'insights gerados'}.`;
          },
        )
      : Promise.resolve(null);

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="size-4 text-primary" aria-hidden />
            {view.scope === 'TEAM' ? 'Insights da equipe' : 'Insights da carteira'}
          </CardTitle>
          <CardDescription>
            {view.generatedAt
              ? `Gerados em ${formatDateTime(view.generatedAt)}. Os números vêm do sistema; a redação pode ser da IA.`
              : 'Gerados todo dia às 07h05.'}
          </CardDescription>
        </div>
        {refreshScope ? (
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw aria-hidden className={cn(busy && 'animate-spin')} /> Atualizar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {notice ? (
          <Alert variant={notice.variant} className="mb-3">
            {notice.text}
          </Alert>
        ) : null}
        {view.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada a destacar por enquanto.</p>
        ) : (
          <ul className="divide-y" aria-label="Insights">
            {view.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="flex-1 space-y-1">
                  <p className="text-sm">{item.text}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {item.label}
                    {item.source === 'AI' ? <Badge variant="muted">Redigido pela IA</Badge> : null}
                  </p>
                </div>
                <div
                  className="flex shrink-0 gap-1"
                  role="group"
                  aria-label="Este insight foi útil?"
                >
                  <Button
                    variant={item.feedback === 'USEFUL' ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={item.feedback === 'USEFUL'}
                    disabled={busy}
                    onClick={() => void rate(item.id, 'USEFUL')}
                  >
                    <ThumbsUp aria-hidden />
                    <span className="sr-only sm:not-sr-only">Útil</span>
                  </Button>
                  <Button
                    variant={item.feedback === 'NOT_USEFUL' ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={item.feedback === 'NOT_USEFUL'}
                    disabled={busy}
                    onClick={() => void rate(item.id, 'NOT_USEFUL')}
                  >
                    <ThumbsDown aria-hidden />
                    <span className="sr-only sm:not-sr-only">Não útil</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
