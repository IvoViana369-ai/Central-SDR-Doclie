'use client';

import type { getAutoAssignSettings } from '@docline/core';
import {
  AUTO_ASSIGN_SKIP_LABELS,
  AUTO_ASSIGN_STRATEGIES,
  AUTO_ASSIGN_STRATEGY_LABELS,
  type AutoAssignSettings,
  type AutoAssignSkip,
} from '@docline/core/leads-domain';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { fmtInt } from '@/components/analytics/format';
import { useAction } from '@/components/leads/use-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

type Data = Awaited<ReturnType<typeof getAutoAssignSettings>>;
type Member = Data['team'][number];
type Editable = Omit<AutoAssignSettings, 'enabledAt'>;

const territoryText = (m: Member) =>
  m.territoryLabels.length === 0 ? 'Sem território' : m.territoryLabels.join(', ');

/** Configuração da distribuição, última execução e a disponibilidade de cada SDR. */
export function DistributionSettings({ data }: { data: Data }) {
  const { run, notice, busy } = useAction();
  const { enabledAt: _enabledAt, ...initial } = data.settings;
  const [settings, setSettings] = useState<Editable>(initial);
  const set = (patch: Partial<Editable>) => setSettings((s) => ({ ...s, ...patch }));
  const lastRun = data.lastRun;

  const save = () =>
    run(
      () => api('/settings/auto-assign', { method: 'PUT', body: settings }),
      settings.enabled
        ? 'Distribuição salva e ligada: a primeira rodada já foi pedida.'
        : 'Distribuição salva (desligada).',
    );
  const distributeNow = () =>
    run(
      () => api('/settings/auto-assign/run', { method: 'POST' }),
      'Distribuição pedida: o worker distribui em instantes.',
    );

  return (
    <div className="space-y-4">
      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Configuração</CardTitle>
              <CardDescription>
                {data.settings.enabled && data.settings.enabledAt
                  ? `Ligada desde ${formatDateTime(data.settings.enabledAt)}.`
                  : 'Desligada: os leads do pool só saem por atribuição manual, campanha ou "puxar do pool".'}
              </CardDescription>
            </div>
            <Badge variant={data.settings.enabled ? 'success' : 'muted'}>
              {data.settings.enabled ? 'Ligada' : 'Desligada'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              Distribuir automaticamente os leads sem responsável
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Como distribuir</legend>
              <div className="flex flex-col gap-2">
                {AUTO_ASSIGN_STRATEGIES.map((strategy) => (
                  <label key={strategy} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="strategy"
                      value={strategy}
                      checked={settings.strategy === strategy}
                      onChange={() => set({ strategy })}
                    />
                    {AUTO_ASSIGN_STRATEGY_LABELS[strategy]}
                  </label>
                ))}
              </div>
            </fieldset>
            {settings.strategy === 'TERRITORY' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.fallbackToAll}
                  onChange={(e) => set({ fallbackToAll: e.target.checked })}
                />
                Lead de cidade sem SDR (ou com todos no limite) entra no rodízio geral
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.includeExistingPool}
                onChange={(e) => set({ includeExistingPool: e.target.checked })}
              />
              Incluir o pool que já existia (não só os leads novos)
            </label>
            <Field
              label="Limite padrão de leads ativos por SDR"
              htmlFor="defaultCapacity"
              hint="Vale para quem não tem um limite próprio (abaixo)."
            >
              <Input
                id="defaultCapacity"
                type="number"
                min={1}
                max={5000}
                className="max-w-32"
                value={settings.defaultCapacity}
                onChange={(e) => set({ defaultCapacity: Number(e.target.value) })}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Salvar
              </Button>
              {data.settings.enabled ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void distributeNow()}
                >
                  <Play aria-hidden /> Distribuir agora
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Última execução</CardTitle>
          <CardDescription>
            {lastRun
              ? `${formatDateTime(lastRun.at)}: ${fmtInt(lastRun.assigned)} de ${fmtInt(lastRun.candidates)} leads distribuídos.`
              : 'Ainda não rodou.'}
          </CardDescription>
        </CardHeader>
        {lastRun && Object.keys(lastRun.skipped).length > 0 ? (
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(Object.entries(lastRun.skipped) as [AutoAssignSkip, number][]).map(
                ([reason, count]) => (
                  <li key={reason}>
                    Ficaram no pool: {fmtInt(count)} — {AUTO_ASSIGN_SKIP_LABELS[reason]}
                  </li>
                ),
              )}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disponibilidade dos SDRs</CardTitle>
          <CardDescription>
            Quem participa, o limite próprio de leads ativos (vazio usa o padrão) e a ausência
            (inclusive o último dia). Territórios são definidos na Equipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum SDR ativo.</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>SDR</Th>
                  <Th>Território</Th>
                  <Th className="text-right">Leads ativos</Th>
                  <Th>Participa</Th>
                  <Th>Limite próprio</Th>
                  <Th>Ausente até</Th>
                  <Th>Hoje</Th>
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {data.team.map((member) => (
                  <MemberRow key={member.userId} member={member} />
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberRow({ member }: { member: Member }) {
  const { run, notice, busy } = useAction();
  const [autoAssign, setAutoAssign] = useState(member.autoAssign);
  const [limit, setLimit] = useState(member.maxActiveLeads?.toString() ?? '');
  const [awayUntil, setAwayUntil] = useState(member.awayUntil ?? '');
  const save = () =>
    run(
      () =>
        api(`/users/${member.userId}/availability`, {
          method: 'PATCH',
          body: {
            autoAssign,
            maxActiveLeads: limit.trim() === '' ? null : Number(limit),
            awayUntil: awayUntil === '' ? null : awayUntil,
          },
        }),
      `Disponibilidade de ${member.name} salva.`,
    );
  return (
    <Tr>
      <Td className="font-medium">
        {member.name}
        {notice ? (
          <span
            role={notice.variant === 'error' ? 'alert' : 'status'}
            className={cn(
              'block text-xs',
              notice.variant === 'error' ? 'text-destructive' : 'text-success',
            )}
          >
            {notice.text}
          </span>
        ) : null}
      </Td>
      <Td className="text-xs text-muted-foreground">{territoryText(member)}</Td>
      <Td className="text-right tabular-nums">
        {fmtInt(member.activeLeads)} / {fmtInt(member.capacity)}
      </Td>
      <Td>
        <input
          type="checkbox"
          aria-label={`${member.name} participa da distribuição`}
          checked={autoAssign}
          onChange={(e) => setAutoAssign(e.target.checked)}
        />
      </Td>
      <Td>
        <Input
          type="number"
          min={1}
          max={5000}
          aria-label={`Limite próprio de ${member.name}`}
          className="h-8 w-24"
          value={limit}
          placeholder="Padrão"
          onChange={(e) => setLimit(e.target.value)}
        />
      </Td>
      <Td>
        <Input
          type="date"
          aria-label={`${member.name} ausente até`}
          className="h-8 w-40"
          value={awayUntil}
          onChange={(e) => setAwayUntil(e.target.value)}
        />
      </Td>
      <Td>
        <Badge variant={member.availableToday ? 'success' : 'muted'}>
          {member.availableToday ? 'Disponível' : 'Fora'}
        </Badge>
      </Td>
      <Td>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void save()}
          aria-label={`Salvar disponibilidade de ${member.name}`}
        >
          Salvar
        </Button>
      </Td>
    </Tr>
  );
}
