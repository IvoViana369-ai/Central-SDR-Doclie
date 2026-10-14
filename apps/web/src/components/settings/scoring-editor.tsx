'use client';

import { LEAD_TYPE_LABELS } from '@docline/core/leads-domain';
import { NORMALIZATION_LABELS, SCORE_BAND_LABELS } from '@docline/core/scoring-domain';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

type Band = keyof typeof SCORE_BAND_LABELS;
type Normalization = keyof typeof NORMALIZATION_LABELS;

interface Rule {
  criterionKey: string;
  label?: string;
  params: Record<string, unknown>;
  points: number;
  active: boolean;
  description: string | null;
}

export interface ScoringModelView {
  id: string;
  name: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  normalization: Normalization;
  bands: { band: Band; min: number; max: number }[];
  notes: string | null;
  createdAt: string | Date;
  activatedAt: string | Date | null;
  activatedByName: string | null;
  rules: (Rule & { id: string; label: string; availability: string | null })[];
}

export interface Criterion {
  key: string;
  label: string;
  availability: string | null;
}

interface Simulation {
  total: number;
  bands: { band: Band; label: string; current: number; simulated: number }[];
  bandChanges: number;
  averageScore: number;
}

/** Parâmetros padrão de um critério novo. */
function defaultParams(key: string): Record<string, unknown> {
  if (key === 'in_state') return { ufs: ['CE'] };
  if (key === 'lead_type_in') return { types: ['ACCOUNTING_FIRM'] };
  if (key === 'has_tag') return { tagId: '' };
  if (key === 'instagram_active') return { maxDaysSincePost: 30 };
  if (key === 'google_reviews_gte') return { min: 10 };
  return {};
}

function ParamsEditor({
  rule,
  index,
  tags,
  onChange,
}: {
  rule: Rule;
  index: number;
  tags: { id: string; name: string }[];
  onChange: (params: Record<string, unknown>) => void;
}) {
  const p = rule.params;
  switch (rule.criterionKey) {
    case 'in_state':
      return (
        <Input
          aria-label={`UFs do critério ${index + 1}`}
          placeholder="CE, PI"
          value={((p.ufs as string[]) ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              ufs: e.target.value
                .toUpperCase()
                .split(/[\s,;]+/)
                .filter(Boolean),
            })
          }
        />
      );
    case 'lead_type_in':
      return (
        <Select
          aria-label={`Tipo de lead do critério ${index + 1}`}
          value={((p.types as string[]) ?? [])[0] ?? ''}
          onChange={(e) => onChange({ types: [e.target.value] })}
        >
          {Object.entries(LEAD_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      );
    case 'has_tag':
      return (
        <Select
          aria-label={`Tag do critério ${index + 1}`}
          value={String(p.tagId ?? '')}
          onChange={(e) => onChange({ tagId: e.target.value })}
        >
          <option value="">Escolha a tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      );
    case 'instagram_active':
      return (
        <Input
          type="number"
          min={1}
          max={365}
          aria-label={`Dias desde a última publicação, critério ${index + 1}`}
          value={Number(p.maxDaysSincePost ?? 30)}
          onChange={(e) => onChange({ maxDaysSincePost: Number(e.target.value) })}
        />
      );
    case 'google_reviews_gte':
      return (
        <Input
          type="number"
          min={1}
          aria-label={`Mínimo de avaliações, critério ${index + 1}`}
          value={Number(p.min ?? 10)}
          onChange={(e) => onChange({ min: Number(e.target.value) })}
        />
      );
    default:
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}

/**
 * Pesos do lead scoring (F4-07): o modelo ativo não muda; o ADMIN edita um
 * rascunho, simula o impacto nas faixas e ativa a nova versão (a base é
 * recalculada no worker).
 */
export function ScoringEditor({
  models,
  criteria,
  tags,
}: {
  models: ScoringModelView[];
  criteria: Criterion[];
  tags: { id: string; name: string }[];
}) {
  const { run, notice, busy } = useAction();
  const active = models.find((m) => m.status === 'ACTIVE') ?? null;
  const [draft, setDraft] = useState<ScoringModelView | null>(
    models.find((m) => m.status === 'DRAFT') ?? null,
  );
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const archived = models.filter((m) => m.status === 'ARCHIVED');
  const criterionOf = (key: string) => criteria.find((c) => c.key === key);

  const patch = (change: Partial<ScoringModelView>) => {
    setSimulation(null);
    setDraft((d) => (d ? { ...d, ...change } : d));
  };
  const patchRule = (index: number, change: Partial<Rule>) =>
    draft && patch({ rules: draft.rules.map((r, i) => (i === index ? { ...r, ...change } : r)) });

  async function saveDraft(current: ScoringModelView) {
    setErrors([]);
    try {
      return await api<ScoringModelView>(`/scoring/models/${current.id}`, {
        method: 'PUT',
        body: {
          name: current.name,
          notes: current.notes,
          normalization: current.normalization,
          bands: current.bands,
          rules: current.rules.map((r) => ({
            criterionKey: r.criterionKey,
            params: r.params,
            points: r.points,
            active: r.active,
            description: r.description,
          })),
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) {
        setErrors(err.errors.map((e) => e.message));
      }
      throw err;
    }
  }

  return (
    <div className="space-y-4">
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Modelo ativo: v{active.version} · {active.name}
            </CardTitle>
            <CardDescription>
              {NORMALIZATION_LABELS[active.normalization]}
              {active.activatedAt
                ? ` · ativado em ${formatDateTime(active.activatedAt)}${active.activatedByName ? ` por ${active.activatedByName}` : ''}`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-label="Regras do modelo ativo">
              {active.rules.map((r) => (
                <li key={r.id} className={r.active ? '' : 'text-muted-foreground line-through'}>
                  {r.label}: <strong>{r.points > 0 ? `+${r.points}` : r.points}</strong>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Faixas:{' '}
              {active.bands
                .map((b) => `${SCORE_BAND_LABELS[b.band]} ${b.min}–${b.max}`)
                .join(' · ')}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!draft ? (
        <Button
          disabled={busy}
          onClick={async () => {
            const created = await run(
              () => api<ScoringModelView>('/scoring/models', { method: 'POST' }),
              'Rascunho criado a partir do modelo ativo.',
            );
            if (created) setDraft(created);
          }}
        >
          Criar rascunho para ajustar os pesos
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Rascunho v{draft.version}</CardTitle>
            <CardDescription>
              Nada muda nos leads até a ativação. Simule antes de ativar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {errors.length > 0 ? (
              <Alert variant="error" title="Revise o rascunho">
                <ul className="list-disc pl-4">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" htmlFor="draftName">
                <Input
                  id="draftName"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field label="Normalização" htmlFor="draftNormalization">
                <Select
                  id="draftNormalization"
                  value={draft.normalization}
                  onChange={(e) => patch({ normalization: e.target.value as Normalization })}
                >
                  {Object.entries(NORMALIZATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Table>
              <THead>
                <Tr>
                  <Th>Critério</Th>
                  <Th className="w-48">Parâmetro</Th>
                  <Th className="w-24">Pontos</Th>
                  <Th className="w-16">Ativo</Th>
                  <Th className="w-10" />
                </Tr>
              </THead>
              <TBody>
                {draft.rules.map((rule, i) => {
                  const criterion = criterionOf(rule.criterionKey);
                  return (
                    <Tr key={i}>
                      <Td>
                        <Select
                          aria-label={`Critério ${i + 1}`}
                          value={rule.criterionKey}
                          onChange={(e) =>
                            patchRule(i, {
                              criterionKey: e.target.value,
                              params: defaultParams(e.target.value),
                            })
                          }
                        >
                          {criteria.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                        {criterion?.availability ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {criterion.availability} Até lá, não pontua.
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <ParamsEditor
                          rule={rule}
                          index={i}
                          tags={tags}
                          onChange={(params) => patchRule(i, { params })}
                        />
                      </Td>
                      <Td>
                        <Input
                          type="number"
                          min={-100}
                          max={100}
                          aria-label={`Pontos do critério ${i + 1}`}
                          value={rule.points}
                          onChange={(e) => patchRule(i, { points: Number(e.target.value) })}
                        />
                      </Td>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Critério ${i + 1} ativo`}
                          checked={rule.active}
                          onChange={(e) => patchRule(i, { active: e.target.checked })}
                        />
                      </Td>
                      <Td>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Remover critério ${i + 1}`}
                          onClick={() => patch({ rules: draft.rules.filter((_, j) => j !== i) })}
                        >
                          <X />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  rules: [
                    ...draft.rules,
                    {
                      id: `new-${draft.rules.length}`,
                      criterionKey: 'has_email',
                      label: '',
                      params: {},
                      points: 10,
                      active: true,
                      description: null,
                      availability: null,
                    },
                  ],
                })
              }
            >
              <Plus /> Adicionar critério
            </Button>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Faixas (0 a 100, sem buracos)</legend>
              <div className="grid gap-2 sm:grid-cols-4">
                {draft.bands.map((b, i) => (
                  <div key={b.band} className="rounded-md border p-2 text-sm">
                    <p className="mb-1 font-medium">{SCORE_BAND_LABELS[b.band]}</p>
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        aria-label={`Início da faixa ${SCORE_BAND_LABELS[b.band]}`}
                        value={b.min}
                        onChange={(e) =>
                          patch({
                            bands: draft.bands.map((x, j) =>
                              j === i ? { ...x, min: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      />
                      a
                      <Input
                        type="number"
                        aria-label={`Fim da faixa ${SCORE_BAND_LABELS[b.band]}`}
                        value={b.max}
                        onChange={(e) =>
                          patch({
                            bands: draft.bands.map((x, j) =>
                              j === i ? { ...x, max: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>

            {simulation ? (
              <div className="rounded-md border p-3" aria-label="Simulação">
                <p className="mb-2 text-sm">
                  Com este rascunho, <strong>{simulation.bandChanges}</strong> de {simulation.total}{' '}
                  leads ativos mudam de faixa · score médio {simulation.averageScore}.
                </p>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Faixa</Th>
                      <Th>Hoje</Th>
                      <Th>Com o rascunho</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {simulation.bands.map((b) => (
                      <Tr key={b.band}>
                        <Td>{b.label}</Td>
                        <Td className="tabular-nums">{b.current}</Td>
                        <Td className="tabular-nums">{b.simulated}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm('Descartar o rascunho? As alterações não salvas se perdem.'))
                    return;
                  const ok = await run(
                    () => api(`/scoring/models/${draft.id}`, { method: 'DELETE' }),
                    'Rascunho descartado.',
                  );
                  if (ok) {
                    setDraft(null);
                    setSimulation(null);
                  }
                }}
              >
                Descartar
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => saveDraft(draft), 'Rascunho salvo.')}
              >
                Salvar rascunho
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const result = await run(async () => {
                    await saveDraft(draft);
                    return api<Simulation>(`/scoring/models/${draft.id}/simulate`, {
                      method: 'POST',
                    });
                  });
                  if (result) setSimulation(result);
                }}
              >
                Simular impacto
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Ativar a versão ${draft.version}? O modelo atual é arquivado e todos os leads são recalculados.`,
                    )
                  )
                    return;
                  const ok = await run(async () => {
                    await saveDraft(draft);
                    return api(`/scoring/models/${draft.id}/activate`, { method: 'POST' });
                  }, `Versão ${draft.version} ativada. O recálculo dos leads roda em segundo plano.`);
                  if (ok) {
                    setDraft(null);
                    setSimulation(null);
                  }
                }}
              >
                Ativar versão
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {archived.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Versões anteriores</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {archived.map((m) => (
                <li key={m.id}>
                  <Badge variant="muted">v{m.version}</Badge> {m.name}
                  {m.activatedAt ? ` · ativada em ${formatDateTime(m.activatedAt)}` : ''}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
