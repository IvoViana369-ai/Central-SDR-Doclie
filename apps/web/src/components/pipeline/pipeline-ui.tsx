import { SCORE_BAND_LABELS } from '@docline/core/scoring-domain';
import type { StageRef } from '@docline/core/pipeline-domain';
import { cn } from '@/lib/utils';

export type ScoreBand = keyof typeof SCORE_BAND_LABELS;

/** Etapa como o quadro e a ficha recebem (getPipeline / getPipelineBoard). */
export interface StageView extends StageRef {
  position: number;
  color: string;
  slaHours: number | null;
  isSystem: boolean;
  ownerRole: string | null;
  description: string | null;
}

export interface LossReasonView {
  id: string;
  key: string;
  name: string;
  appliesToStageKeys: string[];
}

const DOT: Record<string, string> = {
  slate: 'bg-slate-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
};

/** Cores das etapas (as mesmas das tags). */
export const STAGE_COLORS: { value: string; label: string }[] = [
  { value: 'slate', label: 'Cinza' },
  { value: 'red', label: 'Vermelho' },
  { value: 'orange', label: 'Laranja' },
  { value: 'amber', label: 'Amarelo' },
  { value: 'green', label: 'Verde' },
  { value: 'teal', label: 'Verde-água' },
  { value: 'blue', label: 'Azul' },
  { value: 'violet', label: 'Roxo' },
  { value: 'pink', label: 'Rosa' },
];

export const STAGE_CATEGORY_LABELS: Record<string, string> = {
  OPEN: 'Em andamento',
  PARKED: 'Parada',
  WON: 'Ganho',
  LOST: 'Perda',
};

export function StageDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        DOT[color] ?? DOT.slate,
        className,
      )}
      aria-hidden
    />
  );
}

const BAND_STYLES: Record<ScoreBand, string> = {
  COLD: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  WARM: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  HOT: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  PRIORITY: 'bg-green-500/15 text-green-700 dark:text-green-300',
};

/** Score e faixa (Frio, Morno, Quente, Prioridade). */
export function ScoreBadge({
  score,
  band,
  className,
}: {
  score: number | null;
  band: ScoreBand | null;
  className?: string;
}) {
  if (score === null || band === null) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Score em cálculo</span>;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        BAND_STYLES[band],
        className,
      )}
      title={`Score ${score} de 100`}
    >
      <span className="tabular-nums">{score}</span> · {SCORE_BAND_LABELS[band]}
    </span>
  );
}

/** Duração legível: "3 d 4 h", "5 h 10 min", "12 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
  if (hours > 0) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.max(minutes, 0)} min`;
}

/** Motivos de perda que valem para a etapa (lista vazia = todas as etapas de perda). */
export function reasonsFor(reasons: LossReasonView[], stageKey: string): LossReasonView[] {
  return reasons.filter(
    (r) => r.appliesToStageKeys.length === 0 || r.appliesToStageKeys.includes(stageKey),
  );
}
