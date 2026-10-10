'use client';

import { REPLY_CLASSIFICATION_LABELS } from '@docline/core/messaging-domain';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';

interface Suggestion {
  label: keyof typeof REPLY_CLASSIFICATION_LABELS;
  confidence: number;
  rationale: string;
  suggestedNextStep: string;
  flags: { code: string; message: string }[];
}

/**
 * Sugestão de classificação de uma resposta (docs/AI-SDR.md §12). A IA só
 * sugere: a classificação vale quando a pessoa clica em "Usar sugestão" (ou
 * escolhe outra).
 */
export function ClassifySuggestion({
  messageId,
  initial,
  disabled,
  onUse,
}: {
  messageId: string;
  /** Sugestão já feita (ex.: automática, assim que a resposta chegou pelo WhatsApp). */
  initial?: { label: string } & Omit<Suggestion, 'label'>;
  disabled?: boolean;
  onUse: (classification: string) => void;
}) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(
    initial ? (initial as Suggestion) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      setSuggestion(
        await api<Suggestion>('/ai/classify-reply', { method: 'POST', body: { messageId } }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível sugerir.');
    } finally {
      setBusy(false);
    }
  }

  if (!suggestion) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={suggest}>
          <Sparkles /> Sugerir com IA
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </span>
    );
  }
  return (
    <div className="mt-2 w-full space-y-1 rounded-md border border-dashed p-2 text-xs">
      <p>
        <span className="font-medium">
          Sugestão da IA: {REPLY_CLASSIFICATION_LABELS[suggestion.label] ?? suggestion.label}
        </span>{' '}
        <span className="text-muted-foreground">
          ({Math.round(suggestion.confidence * 100)}% de confiança) — {suggestion.rationale}
        </span>
      </p>
      {suggestion.suggestedNextStep ? (
        <p className="text-muted-foreground">Próximo passo: {suggestion.suggestedNextStep}</p>
      ) : null}
      {suggestion.flags.map((f) => (
        <p key={f.code} className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {f.message}
        </p>
      ))}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            onUse(suggestion.label);
            setSuggestion(null);
          }}
        >
          Usar sugestão
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
          Ignorar
        </Button>
      </div>
    </div>
  );
}
