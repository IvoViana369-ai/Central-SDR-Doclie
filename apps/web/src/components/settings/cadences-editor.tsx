'use client';

import { CHANNEL_LABELS } from '@docline/core/messaging-domain';
import {
  CADENCE_ACTION_LABELS,
  CADENCE_ACTIONS,
  CADENCE_CHANNELS,
  CADENCE_MESSAGE_TYPES,
  STEP_TASK_TITLES,
} from '@docline/core/cadence-domain';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

/** Valores como o banco devolve; a validação fica no servidor. */
export interface CadenceStepView {
  dayOffset: number;
  channel: string;
  action: string;
  messageType: string;
  targetStageKey: string | null;
  instructions: string | null;
}

export interface CadenceView {
  id: string;
  name: string;
  description: string | null;
  version: number;
  active: boolean;
  isDefault: boolean;
  stopOnReply: boolean;
  useBusinessDays: boolean;
  sendWindowStart: string;
  sendWindowEnd: string;
  noResponseAfterDays: number;
  ongoingEnrollments: number;
  steps: CadenceStepView[];
}

type Draft = Omit<CadenceView, 'id' | 'version' | 'isDefault' | 'ongoingEnrollments'> & {
  id?: string;
};

const NEW_DRAFT: Draft = {
  name: '',
  description: null,
  active: true,
  stopOnReply: true,
  useBusinessDays: true,
  sendWindowStart: '08:00',
  sendWindowEnd: '18:00',
  noResponseAfterDays: 3,
  steps: [
    {
      dayOffset: 0,
      channel: 'WHATSAPP',
      action: 'ASSISTED_MESSAGE',
      messageType: 'FIRST_CONTACT',
      targetStageKey: 'FIRST_CONTACT',
      instructions: null,
    },
  ],
};

/**
 * Cadências (ADMIN; F5-03): passos D0/D2/D5…, canal, etapa de destino e
 * regras. Cada mudança sobe a versão; quem já está na cadência segue pela
 * posição do passo. Nada é excluído: uma cadência fora de uso é desativada.
 */
export function CadencesEditor({
  cadences,
  stages,
}: {
  cadences: CadenceView[];
  stages: { key: string; name: string }[];
}) {
  const { run, notice, busy } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="space-y-4">
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      {draft ? (
        <CadenceForm
          key={draft.id ?? 'new'}
          initial={draft}
          stages={stages}
          onCancel={() => setDraft(null)}
          onSaved={(message) => {
            setDraft(null);
            void run(async () => null, message);
          }}
        />
      ) : (
        <Button onClick={() => setDraft(NEW_DRAFT)}>
          <Plus /> Nova cadência
        </Button>
      )}
      {cadences.map((c) => (
        <Card key={c.id} data-testid="cadence">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {c.name}
                {c.isDefault ? <Badge>Padrão</Badge> : null}
                {!c.active ? <Badge variant="muted">Inativa</Badge> : null}
                <span className="text-xs font-normal text-muted-foreground">v{c.version}</span>
              </CardTitle>
              <CardDescription>
                {c.description ? `${c.description} · ` : ''}
                {c.ongoingEnrollments} lead(s) em andamento
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!c.isDefault && c.active ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api(`/cadences/${c.id}/default`, { method: 'POST' }),
                      `"${c.name}" agora é a cadência padrão.`,
                    )
                  }
                >
                  Tornar padrão
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(draft)}
                onClick={() => setDraft(c)}
              >
                Editar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Tarefas entre {c.sendWindowStart} e {c.sendWindowEnd} (hora do lead),{' '}
              {c.useBusinessDays ? 'em dias úteis' : 'em dias corridos'}. &quot;Sem resposta&quot;{' '}
              {c.noResponseAfterDays} dia(s) após o último passo.{' '}
              {c.stopOnReply ? 'Para quando o lead responde.' : 'Não para com resposta.'}
            </p>
            <ol className="flex flex-wrap gap-2" aria-label={`Passos de ${c.name}`}>
              {c.steps.map((s, i) => (
                <li key={i} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  D{s.dayOffset} · {STEP_TASK_TITLES[s.messageType]} ·{' '}
                  {CHANNEL_LABELS[s.channel] ?? s.channel}
                  {s.targetStageKey
                    ? ` → ${stages.find((st) => st.key === s.targetStageKey)?.name ?? s.targetStageKey}`
                    : ''}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CadenceForm({
  initial,
  stages,
  onCancel,
  onSaved,
}: {
  initial: Draft;
  stages: { key: string; name: string }[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setStep = (index: number, patch: Partial<CadenceStepView>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  const errorOf = (path: string) => errors.find((e) => e.path === path)?.message;
  const stepErrors = errors.filter((e) => e.path === 'steps' || e.path.startsWith('steps.'));

  async function save() {
    setBusy(true);
    setError(null);
    setErrors([]);
    const body = {
      name: draft.name,
      description: draft.description,
      active: draft.active,
      stopOnReply: draft.stopOnReply,
      useBusinessDays: draft.useBusinessDays,
      sendWindowStart: draft.sendWindowStart,
      sendWindowEnd: draft.sendWindowEnd,
      noResponseAfterDays: draft.noResponseAfterDays,
      steps: draft.steps,
    };
    try {
      if (draft.id) await api(`/cadences/${draft.id}`, { method: 'PUT', body });
      else await api('/cadences', { method: 'POST', body });
      onSaved(
        draft.id
          ? 'Cadência salva (nova versão). Quem já está nela segue pela posição do passo.'
          : 'Cadência criada.',
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors);
        setError(err.message);
      } else {
        setError('Não foi possível salvar.');
      }
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{draft.id ? `Editar ${initial.name}` : 'Nova cadência'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" htmlFor="cadenceName" error={errorOf('name')}>
              <Input
                id="cadenceName"
                value={draft.name}
                maxLength={80}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Descrição" htmlFor="cadenceDescription">
              <Input
                id="cadenceDescription"
                value={draft.description ?? ''}
                maxLength={300}
                onChange={(e) => set({ description: e.target.value || null })}
              />
            </Field>
            <Field
              label="Início da janela"
              htmlFor="cadenceWindowStart"
              hint="Hora do lead, HH:MM."
              error={errorOf('sendWindowStart')}
            >
              <Input
                id="cadenceWindowStart"
                value={draft.sendWindowStart}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => set({ sendWindowStart: e.target.value })}
              />
            </Field>
            <Field
              label="Fim da janela"
              htmlFor="cadenceWindowEnd"
              hint="24:00 vai até o fim do dia."
              error={errorOf('sendWindowEnd')}
            >
              <Input
                id="cadenceWindowEnd"
                value={draft.sendWindowEnd}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => set({ sendWindowEnd: e.target.value })}
              />
            </Field>
            <Field
              label='Dias até "Sem resposta"'
              htmlFor="cadenceNoResponse"
              hint="Contados do último passo."
              error={errorOf('noResponseAfterDays')}
            >
              <Input
                id="cadenceNoResponse"
                type="number"
                min={1}
                max={60}
                value={draft.noResponseAfterDays}
                onChange={(e) => set({ noResponseAfterDays: Number(e.target.value) })}
              />
            </Field>
            <div className="space-y-2 pt-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.useBusinessDays}
                  onChange={(e) => set({ useBusinessDays: e.target.checked })}
                />
                Contar em dias úteis (pula fins de semana e feriados)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.stopOnReply}
                  onChange={(e) => set({ stopOnReply: e.target.checked })}
                />
                Parar quando o lead responder
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => set({ active: e.target.checked })}
                />
                Ativa (disponível para inscrever leads)
              </label>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Passos</legend>
            {draft.steps.map((step, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-md border p-2 sm:grid-cols-[5rem_1fr_1fr_1fr_1fr_auto] sm:items-end"
                data-testid="cadence-step"
              >
                <Field label="Dia" htmlFor={`step${i}Day`}>
                  <Input
                    id={`step${i}Day`}
                    type="number"
                    min={0}
                    max={365}
                    value={step.dayOffset}
                    onChange={(e) => setStep(i, { dayOffset: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Mensagem" htmlFor={`step${i}Type`}>
                  <Select
                    id={`step${i}Type`}
                    value={step.messageType}
                    onChange={(e) => setStep(i, { messageType: e.target.value })}
                  >
                    {CADENCE_MESSAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {STEP_TASK_TITLES[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Canal" htmlFor={`step${i}Channel`}>
                  <Select
                    id={`step${i}Channel`}
                    value={step.channel}
                    onChange={(e) => setStep(i, { channel: e.target.value })}
                  >
                    {CADENCE_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c] ?? c}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ação" htmlFor={`step${i}Action`}>
                  <Select
                    id={`step${i}Action`}
                    value={step.action}
                    onChange={(e) => setStep(i, { action: e.target.value })}
                  >
                    {CADENCE_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {CADENCE_ACTION_LABELS[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Leva o lead para" htmlFor={`step${i}Stage`}>
                  <Select
                    id={`step${i}Stage`}
                    value={step.targetStageKey ?? ''}
                    onChange={(e) => setStep(i, { targetStageKey: e.target.value || null })}
                  >
                    <option value="">Não muda a etapa</option>
                    {stages.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover passo ${i + 1}`}
                  disabled={draft.steps.length === 1}
                  onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}
                >
                  <X />
                </Button>
                <div className="sm:col-span-6">
                  <Input
                    aria-label={`Orientação do passo ${i + 1}`}
                    placeholder="Orientação para o SDR (opcional)"
                    maxLength={500}
                    value={step.instructions ?? ''}
                    onChange={(e) => setStep(i, { instructions: e.target.value || null })}
                  />
                </div>
              </div>
            ))}
            {stepErrors.length > 0 ? (
              <p className="text-sm text-destructive" role="alert">
                {stepErrors.map((e) => e.message).join(' ')}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.steps.length >= 15}
              onClick={() => {
                const last = draft.steps.at(-1);
                set({
                  steps: [
                    ...draft.steps,
                    {
                      dayOffset: (last?.dayOffset ?? -1) + 1,
                      channel: last?.channel ?? 'WHATSAPP',
                      action: 'ASSISTED_MESSAGE',
                      messageType: 'OTHER',
                      targetStageKey: null,
                      instructions: null,
                    },
                  ],
                });
              }}
            >
              <Plus /> Adicionar passo
            </Button>
          </fieldset>

          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || draft.name.trim().length < 2}>
              Salvar cadência
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
