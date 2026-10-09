'use client';

import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { STAGE_CATEGORY_LABELS, STAGE_COLORS, StageDot } from '@/components/pipeline/pipeline-ui';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { useAction } from '@/components/leads/use-action';
import { api, ApiError } from '@/lib/api-client';

export interface EditableStage {
  id?: string;
  key?: string;
  name: string;
  color: string;
  slaHours: number | null;
  active: boolean;
  description: string | null;
  category: string;
  isSystem?: boolean;
  leadCount?: number;
}

/**
 * Configuração das etapas (ADMIN; M08): nome, cor, ordem, SLA, ativação e
 * etapas novas. Nada é excluído; etapas do sistema (usadas pelas automações) e
 * etapas com leads não podem ser desativadas.
 */
export function StagesEditor({ initial }: { initial: EditableStage[] }) {
  const { run, notice, setNotice, busy } = useAction();
  const [stages, setStages] = useState<EditableStage[]>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (index: number, patch: Partial<EditableStage>) =>
    setStages((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const swap = (index: number, delta: number) =>
    setStages((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  async function save() {
    setErrors({});
    const result = await run(async () => {
      try {
        await api('/pipelines/default/stages', {
          method: 'PUT',
          body: {
            stages: stages.map((s) => ({
              ...(s.id ? { id: s.id } : { category: s.category }),
              name: s.name,
              color: s.color,
              slaHours: s.slaHours,
              active: s.active,
              description: s.description,
            })),
          },
        });
      } catch (err) {
        if (err instanceof ApiError) {
          setErrors(Object.fromEntries(err.errors.map((e) => [e.path, e.message])));
        }
        throw err;
      }
      // Recarrega para as etapas novas ganharem id (salvar de novo não as duplica).
      return api<{ stages: EditableStage[] }>('/pipelines/default');
    }, 'Etapas salvas. O quadro já usa a configuração nova.');
    if (result) setStages(result.stages);
  }

  const errorOf = (i: number, field: string) => errors[`stages.${i}.${field}`];

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert variant={notice.variant} className="mb-2">
          {notice.text}
        </Alert>
      ) : null}
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th className="w-20">Ordem</Th>
              <Th>Etapa</Th>
              <Th className="w-36">Cor</Th>
              <Th className="w-28">SLA (horas)</Th>
              <Th className="w-24">Ativa</Th>
            </Tr>
          </THead>
          <TBody>
            {stages.map((stage, i) => {
              const locked = stage.isSystem || (stage.leadCount ?? 0) > 0;
              const rowErrors = ['name', 'active', 'category', 'id']
                .map((f) => errorOf(i, f))
                .filter(Boolean);
              return (
                <Tr key={stage.id ?? `new-${i}`}>
                  <Td>
                    <span className="flex gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Subir ${stage.name}`}
                        disabled={i === 0}
                        onClick={() => swap(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Descer ${stage.name}`}
                        disabled={i === stages.length - 1}
                        onClick={() => swap(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <StageDot color={stage.color} />
                      <Input
                        aria-label={`Nome da etapa ${i + 1}`}
                        value={stage.name}
                        maxLength={40}
                        aria-invalid={Boolean(errorOf(i, 'name')) || undefined}
                        onChange={(e) => update(i, { name: e.target.value })}
                      />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {stage.id ? (
                        <Badge variant="muted">{STAGE_CATEGORY_LABELS[stage.category]}</Badge>
                      ) : (
                        <Select
                          aria-label={`Tipo da etapa ${i + 1}`}
                          className="h-7 w-auto text-xs"
                          value={stage.category}
                          onChange={(e) => update(i, { category: e.target.value })}
                        >
                          <option value="OPEN">{STAGE_CATEGORY_LABELS.OPEN}</option>
                          <option value="PARKED">{STAGE_CATEGORY_LABELS.PARKED}</option>
                          <option value="LOST">{STAGE_CATEGORY_LABELS.LOST}</option>
                        </Select>
                      )}
                      {stage.isSystem ? <span>usada pelas automações</span> : null}
                      {stage.leadCount ? <span>· {stage.leadCount} lead(s)</span> : null}
                    </span>
                    {rowErrors.map((message) => (
                      <p key={message} className="mt-1 text-xs text-destructive" role="alert">
                        {message}
                      </p>
                    ))}
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Cor da etapa ${stage.name}`}
                      value={stage.color}
                      onChange={(e) => update(i, { color: e.target.value })}
                    >
                      {STAGE_COLORS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Input
                      type="number"
                      min={1}
                      max={2160}
                      aria-label={`SLA da etapa ${stage.name}`}
                      placeholder="—"
                      value={stage.slaHours ?? ''}
                      onChange={(e) =>
                        update(i, { slaHours: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Etapa ${stage.name} ativa`}
                      checked={stage.active}
                      disabled={stage.active && locked}
                      title={
                        stage.active && locked
                          ? stage.isSystem
                            ? 'Etapa usada pelas automações.'
                            : 'Mova os leads antes de desativar.'
                          : undefined
                      }
                      onChange={(e) => update(i, { active: e.target.checked })}
                    />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setNotice(null);
            setStages((list) => [
              ...list,
              {
                name: '',
                color: 'slate',
                slaHours: null,
                active: true,
                description: null,
                category: 'OPEN',
              },
            ]);
          }}
        >
          <Plus /> Nova etapa
        </Button>
        <Button disabled={busy} onClick={save}>
          Salvar etapas
        </Button>
      </div>
    </div>
  );
}
