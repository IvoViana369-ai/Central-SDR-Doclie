'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { MoveStageDialog } from './move-stage-dialog';
import { formatDuration, StageDot, type LossReasonView, type StageView } from './pipeline-ui';

export interface StageHistoryItem {
  id: string;
  from: { key: string; name: string } | null;
  to: { key: string; name: string; category: string; color: string };
  enteredAt: string | Date;
  leftAt: string | Date | null;
  durationSeconds: number;
  current: boolean;
  changedByName: string | null;
  automationSource: string | null;
  lossReason: { key: string; name: string } | null;
  note: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  CADENCE: 'cadência',
  INBOUND: 'resposta recebida',
  IMPORT: 'importação',
  HANDOFF: 'transferência',
  RULE: 'regra do sistema',
  MERGE: 'mesclagem',
};

/** Etapa atual, botão de mover e histórico com a duração de cada passagem (M08). */
export function LeadStageCard({
  lead,
  stages,
  lossReasons,
  history,
  canMove,
  privileged,
}: {
  lead: {
    id: string;
    version: number;
    displayName: string;
    stageId: string | null;
    lossReason: { name: string } | null;
  };
  stages: StageView[];
  lossReasons: LossReasonView[];
  history: StageHistoryItem[];
  canMove: boolean;
  privileged: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const stage = stages.find((s) => s.id === lead.stageId) ?? null;
  const current = history.find((h) => h.current);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Etapa no pipeline</CardTitle>
        {canMove ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Mover
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
        {stage ? (
          <p className="flex items-center gap-2 text-sm" data-testid="lead-stage">
            <StageDot color={stage.color} />
            <strong>{stage.name}</strong>
            {current ? (
              <span className="text-muted-foreground">
                há {formatDuration(current.durationSeconds)}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Fora do funil.</p>
        )}
        {lead.lossReason && stage?.category === 'LOST' ? (
          <p className="text-sm">Motivo: {lead.lossReason.name}</p>
        ) : null}

        {history.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Histórico de etapas ({history.length})
            </summary>
            <ol className="mt-2 space-y-2 border-l pl-3" aria-label="Histórico de etapas">
              {history.map((h) => (
                <li key={h.id}>
                  <p className="flex items-center gap-1.5 font-medium">
                    <StageDot color={h.to.color} />
                    {h.to.name}
                    <span className="font-normal text-muted-foreground">
                      · {formatDuration(h.durationSeconds)}
                      {h.current ? ' até agora' : ''}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(h.enteredAt)} ·{' '}
                    {h.changedByName ??
                      (h.automationSource ? SOURCE_LABELS[h.automationSource] : 'sistema')}
                    {h.from ? ` · veio de "${h.from.name}"` : ''}
                  </p>
                  {h.lossReason ? <p className="text-xs">Motivo: {h.lossReason.name}</p> : null}
                  {h.note ? <p className="text-xs italic">{h.note}</p> : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </CardContent>

      {open ? (
        <MoveStageDialog
          target={{ lead }}
          stages={stages}
          lossReasons={lossReasons}
          privileged={privileged}
          onClose={() => setOpen(false)}
          onMoved={(result) => {
            setOpen(false);
            setNotice({
              variant: 'success',
              text: result.optedOut
                ? `Movido para "${result.stageName}". O lead entrou na Lista Não Contatar.`
                : `Movido para "${result.stageName}".`,
            });
            router.refresh();
          }}
          onConflict={(message) => {
            setOpen(false);
            setNotice({ variant: 'error', text: message });
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}
