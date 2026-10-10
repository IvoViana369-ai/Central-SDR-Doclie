'use client';

import type { GenerationView } from '@docline/core';
import { CircleAlert, Info, Sparkles, Star, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Avisos de um rascunho da IA (docs/AI-SDR.md §10): o que bloqueia a
 * aprovação (em vermelho, com o que corrigir), avisos, contexto fraco e as
 * suposições que o SDR deve conferir. Nada aqui é decorativo: cada item pede
 * uma leitura antes de enviar.
 */
export function DraftNotes({
  draft,
  onApplySuggestion,
}: {
  draft: GenerationView;
  /** Inserir a correção sugerida (ex.: a frase de opt-out) no texto. */
  onApplySuggestion?: (text: string) => void;
}) {
  const blocking = draft.flags.filter((f) => f.severity === 'BLOCKING');
  const warnings = draft.flags.filter((f) => f.severity === 'WARNING');
  const toCheck = [...draft.assumptions, ...draft.missingInfo.map((m) => `Faltou: ${m}`)];

  return (
    <div className="space-y-2 text-sm" data-testid="ai-draft-notes">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge>
          <Sparkles className="size-3" aria-hidden /> Rascunho da IA
        </Badge>
        <span>
          {draft.statusLabel} · {draft.prompt} · {draft.model}
        </span>
      </p>
      {draft.provider === 'fake' ? (
        <Alert>
          IA de demonstração: o texto vem de um modelo fixo, sem IA real. Revise como se fosse seu.
        </Alert>
      ) : null}
      {blocking.length > 0 ? (
        <Alert variant="error" title="Corrija antes de aprovar">
          <ul className="list-disc space-y-0.5 pl-4">
            {blocking.map((f, i) => (
              <li key={`${f.code}-${i}`}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="space-y-1" aria-label="Avisos do rascunho">
          {warnings.map((f, i) => (
            <li key={`${f.code}-${i}`} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                {f.message}
                {f.suggestion && onApplySuggestion ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="ml-1 h-auto p-0"
                    onClick={() => onApplySuggestion(f.suggestion!)}
                  >
                    Incluir “{f.suggestion}”
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {draft.contextWarnings.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground" aria-label="Contexto do rascunho">
          {draft.contextWarnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {toCheck.length > 0 ? (
        <div className="rounded-md border border-dashed p-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <CircleAlert className="size-3.5" aria-hidden /> Confira antes de enviar
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {toCheck.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Nota de 1 a 5 para o rascunho (alimenta a avaliação de qualidade, §14). */
export function DraftRating({ generationId }: { generationId: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rate(value: number) {
    setError(null);
    try {
      await api(`/ai/generations/${generationId}/rate`, {
        method: 'POST',
        body: { rating: value },
      });
      setRating(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar a nota.');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Como ficou o rascunho da IA?</span>
      <div role="group" aria-label="Nota do rascunho" className="flex">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Nota ${value}`}
            aria-pressed={rating === value}
            className="rounded p-0.5 hover:bg-muted"
            onClick={() => void rate(value)}
          >
            <Star
              className={cn(
                'size-5',
                rating !== null && value <= rating
                  ? 'fill-warning text-warning'
                  : 'text-muted-foreground',
              )}
              aria-hidden
            />
          </button>
        ))}
      </div>
      {rating !== null ? <span className="text-xs text-muted-foreground">Obrigado!</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
