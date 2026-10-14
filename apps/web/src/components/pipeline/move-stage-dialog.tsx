'use client';

import { checkTransition, OPT_OUT_LOSS_REASON } from '@docline/core/pipeline-domain';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { reasonsFor, type LossReasonView, type StageView } from './pipeline-ui';

export interface MoveResult {
  leadId: string;
  stageId: string;
  stageKey: string;
  stageName: string;
  version: number;
  optedOut: boolean;
}

export const CONFLICT_MESSAGE =
  'Outra pessoa alterou este lead agora há pouco. Os dados foram atualizados; confira e tente de novo.';

export interface MoveTarget {
  lead: { id: string; version: number; displayName: string; stageId: string | null };
  /** Etapa já escolhida (ex.: card solto numa coluna de perda). */
  stageId?: string;
}

/**
 * Mover de etapa com motivo de perda e observação. É também a alternativa ao
 * arrastar (teclado, leitor de tela e celular).
 */
export function MoveStageDialog({
  target,
  stages,
  lossReasons,
  privileged,
  onClose,
  onMoved,
  onConflict,
}: {
  target: MoveTarget;
  stages: StageView[];
  lossReasons: LossReasonView[];
  privileged: boolean;
  onClose: () => void;
  onMoved: (result: MoveResult) => void;
  /** Outra pessoa alterou o lead: quem chamou fecha o diálogo e recarrega os dados. */
  onConflict: (message: string) => void;
}) {
  const from = stages.find((s) => s.id === target.lead.stageId) ?? null;
  const [stageId, setStageId] = useState(target.stageId ?? '');
  const [lossReasonId, setLossReasonId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const to = stages.find((s) => s.id === stageId) ?? null;
  const reasons = to?.category === 'LOST' ? reasonsFor(lossReasons, to.key) : [];
  const reason = reasons.find((r) => r.id === lossReasonId) ?? null;
  const check = to
    ? checkTransition({ from, to, privileged, lossReasonGiven: Boolean(reason) })
    : null;
  // Para a lista: a etapa é possível (o motivo é pedido depois de escolhida).
  const reachable = (stage: StageView) =>
    checkTransition({ from, to: stage, privileged, lossReasonGiven: true });

  async function submit() {
    if (!to || !check?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<MoveResult>(`/leads/${target.lead.id}/stage`, {
        method: 'POST',
        body: {
          stageId: to.id,
          version: target.lead.version,
          lossReasonId: reason?.id ?? null,
          note: note || null,
        },
      });
      onMoved(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Lock otimista: o card volta e quem chamou recarrega o que mudou.
        onConflict(CONFLICT_MESSAGE);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível mover o lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        title="Mover de etapa"
        description={
          <>
            {target.lead.displayName}
            {from ? ` · hoje em "${from.name}"` : ''}
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Nova etapa"
            htmlFor="moveStage"
            error={
              to && check && !check.ok && check.error !== 'LOSS_REASON_REQUIRED'
                ? check.message
                : undefined
            }
            hint={
              check?.ok && check.override
                ? 'Movimentação de gestor: fica registrada na auditoria.'
                : undefined
            }
          >
            <Select
              id="moveStage"
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                setLossReasonId('');
              }}
            >
              <option value="">Escolha a etapa</option>
              {stages
                .filter((s) => s.active || s.id === stageId)
                .map((s) => {
                  const ok = reachable(s).ok;
                  return (
                    <option key={s.id} value={s.id} disabled={!ok && s.id !== stageId}>
                      {s.name}
                      {s.id === from?.id ? ' (atual)' : ok ? '' : ' — indisponível'}
                    </option>
                  );
                })}
            </Select>
          </Field>

          {to?.category === 'LOST' ? (
            <Field
              label={to.requiresLossReason ? 'Motivo da perda' : 'Motivo da perda (opcional)'}
              htmlFor="moveLossReason"
            >
              <Select
                id="moveLossReason"
                value={lossReasonId}
                onChange={(e) => setLossReasonId(e.target.value)}
              >
                <option value="">Escolha o motivo</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {reason?.key === OPT_OUT_LOSS_REASON ? (
            <Alert title="O lead entra na Lista Não Contatar">
              Pedido de não contato vale na hora, para todos os canais (LGPD). Para desfazer, só
              pela Conformidade.
            </Alert>
          ) : null}

          <Field label="Observação (opcional)" htmlFor="moveNote">
            <Textarea
              id="moveNote"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: pediu retorno no próximo mês."
            />
          </Field>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !check?.ok}>
              Mover
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
