'use client';

import { GATE_CHANNEL_LABELS } from '@docline/core/compliance-domain';
import {
  MAX_CAMPAIGN_VARIANTS,
  MAX_DAILY_CONTACT_LIMIT,
  VARIANT_LABELS,
} from '@docline/core/campaigns-domain';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { DISPLAY_TIME_ZONE } from '@/lib/utils';

type Channel = keyof typeof GATE_CHANNEL_LABELS;
const CHANNELS = Object.keys(GATE_CHANNEL_LABELS) as Channel[];

export interface Selection {
  filter?: unknown;
  q?: string;
}

export interface CampaignFormValues {
  id: string;
  version: number;
  status: string;
  name: string;
  objective: string | null;
  ownerId: string;
  channel: Channel;
  cadenceId: string | null;
  sdrIds: string[];
  dailyContactLimit: number;
  minDaysSinceLastContact: number;
  approachIds: string[];
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  selection: Selection;
  filterLabel: string | null;
}

export interface CampaignFormOptions {
  owners: { id: string; name: string }[];
  sdrs: { id: string; name: string; role: string }[];
  cadences: { id: string; name: string; isDefault: boolean }[];
  approaches: { id: string; name: string; hypothesis: string | null }[];
  views: { id: string; name: string; filter: unknown }[];
}

/** "AAAA-MM-DD" de um instante, no fuso da operação. */
function toDay(value: string | Date | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE }).format(new Date(value));
}

/** Início às 00:00 e fim às 23:59 do dia, no fuso da operação (UTC−3). */
const fromDay = (day: string, end: boolean) =>
  day ? `${day}T${end ? '23:59:59' : '00:00:00'}-03:00` : null;

type Source = 'view' | 'list' | 'all' | 'current';

function storedSelection(filter: unknown): Selection {
  const stored = (filter ?? {}) as { filter?: unknown; q?: string | null };
  return {
    ...(stored.filter ? { filter: stored.filter } : {}),
    ...(stored.q ? { q: stored.q } : {}),
  };
}

/**
 * Criar ou editar uma campanha (F10-01). A seleção vem de uma visão salva, do
 * filtro trazido da lista de leads ou de todos os leads ativos; a contagem é
 * uma prévia: o retrato só é congelado ao montar.
 */
export function CampaignForm({
  options,
  initial,
  fromList,
  structureLocked = false,
  currentUserId,
}: {
  options: CampaignFormOptions;
  initial?: CampaignFormValues;
  /** Filtro trazido da lista de leads ("Campanha com este filtro"). */
  fromList?: Selection | null;
  /** Campanha ativa ou pausada: só nome, objetivo, responsável, limite e datas. */
  structureLocked?: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [objective, setObjective] = useState(initial?.objective ?? '');
  const [ownerId, setOwnerId] = useState(
    initial?.ownerId ?? (options.owners.some((o) => o.id === currentUserId) ? currentUserId : ''),
  );
  const [channel, setChannel] = useState<Channel>(initial?.channel ?? 'WHATSAPP');
  const [cadenceId, setCadenceId] = useState(initial?.cadenceId ?? '');
  const [sdrIds, setSdrIds] = useState<string[]>(initial?.sdrIds ?? []);
  const [dailyLimit, setDailyLimit] = useState(initial?.dailyContactLimit ?? 20);
  const [minDays, setMinDays] = useState(initial?.minDaysSinceLastContact ?? 30);
  const [approachIds, setApproachIds] = useState<string[]>(initial?.approachIds ?? []);
  const [startsAt, setStartsAt] = useState(toDay(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDay(initial?.endsAt ?? null));
  const [source, setSource] = useState<Source>(
    initial ? 'current' : fromList ? 'list' : options.views.length > 0 ? 'view' : 'all',
  );
  const [viewId, setViewId] = useState(options.views[0]?.id ?? '');
  const [count, setCount] = useState<{ total: number; contactable: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const view = options.views.find((v) => v.id === viewId);
  const selection: Selection = useMemo(() => {
    if (source === 'current') return initial?.selection ?? {};
    if (source === 'list') return fromList ?? {};
    if (source === 'view') return view ? storedSelection(view.filter) : {};
    return {};
  }, [source, initial, fromList, view]);
  const filterLabel =
    source === 'current'
      ? (initial?.filterLabel ?? null)
      : source === 'list'
        ? 'Filtro da lista de leads'
        : source === 'view'
          ? view
            ? `Visão salva: ${view.name}`
            : null
          : 'Todos os leads ativos';

  // Prévia da seleção (o retrato é congelado só ao montar).
  useEffect(() => {
    if (structureLocked) return;
    let cancelled = false;
    api<{ total: number; contactable: number }>('/leads/count', {
      method: 'POST',
      body: selection,
    })
      .then((result) => {
        if (!cancelled) setCount(result);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, structureLocked]);

  function toggleSdr(id: string) {
    setSdrIds(sdrIds.includes(id) ? sdrIds.filter((s) => s !== id) : [...sdrIds, id]);
  }

  function setVariant(index: number, id: string) {
    const next = [...approachIds];
    next[index] = id;
    setApproachIds(next);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const settings = {
      name: name.trim(),
      objective: objective.trim() || null,
      ownerId: ownerId || undefined,
      dailyContactLimit: dailyLimit,
      startsAt: fromDay(startsAt, false),
      endsAt: fromDay(endsAt, true),
    };
    const structure = {
      channel,
      cadenceId: cadenceId || null,
      sdrIds,
      minDaysSinceLastContact: minDays,
      approachIds: approachIds.filter(Boolean),
      selection,
      filterLabel,
    };
    try {
      if (!initial) {
        const created = await api<{ campaignId: string }>('/campaigns', {
          method: 'POST',
          body: { ...settings, ...structure },
        });
        router.push(`/campanhas/${created.campaignId}`);
        return;
      }
      // Na edição, só a estrutura que mudou (mudar a estrutura descarta o retrato).
      const changed: Record<string, unknown> = {};
      if (!structureLocked) {
        const before: Record<string, unknown> = {
          channel: initial.channel,
          cadenceId: initial.cadenceId,
          sdrIds: initial.sdrIds,
          minDaysSinceLastContact: initial.minDaysSinceLastContact,
          approachIds: initial.approachIds,
          selection: initial.selection,
          filterLabel: initial.filterLabel,
        };
        for (const [key, value] of Object.entries(structure)) {
          if (JSON.stringify(value) !== JSON.stringify(before[key])) changed[key] = value;
        }
      }
      await api(`/campaigns/${initial.id}`, {
        method: 'PATCH',
        body: { version: initial.version, ...settings, ...changed },
      });
      router.push(`/campanhas/${initial.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a campanha.');
      setBusy(false);
    }
  }

  const sdrsAvailable = options.sdrs;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Campanha</CardTitle>
          <CardDescription>
            A campanha seleciona e distribui leads; quem contata é o SDR, pela cadência, e cada
            contato passa pelo gate de sempre. Nenhuma mensagem é enviada pela campanha.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" htmlFor="campaignName">
            <Input
              id="campaignName"
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Responsável" htmlFor="campaignOwner">
            <Select id="campaignOwner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {options.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Objetivo (opcional)" htmlFor="campaignObjective">
              <Textarea
                id="campaignObjective"
                rows={2}
                maxLength={500}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Leads por SDR por dia"
            htmlFor="campaignDailyLimit"
            hint={`Liberados para a fila em dias de expediente (até ${MAX_DAILY_CONTACT_LIMIT}).`}
          >
            <Input
              id="campaignDailyLimit"
              type="number"
              min={1}
              max={MAX_DAILY_CONTACT_LIMIT}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Início (opcional)" htmlFor="campaignStartsAt">
              <Input
                id="campaignStartsAt"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </Field>
            <Field label="Fim (opcional)" htmlFor="campaignEndsAt">
              <Input
                id="campaignEndsAt"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {structureLocked ? (
        <Alert>
          Campanha ativa ou pausada: seleção, canal, cadência, SDRs, abordagens e frequência não
          mudam mais. Para mudar, conclua esta e crie outra.
        </Alert>
      ) : (
        <>
          {initial?.status === 'READY' ? (
            <Alert>
              A campanha já foi montada. Mudar a seleção, o canal, a cadência, os SDRs, as
              abordagens ou a frequência descarta o retrato: será preciso montar de novo.
            </Alert>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Seleção de leads</CardTitle>
              <CardDescription>
                Ao montar, a seleção é congelada (até 5.000 leads) e cada lead é avaliado: Lista Não
                Contatar, base legal, contato no canal, etapa, cadência ou campanha em andamento e
                contato recente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">Origem da seleção</legend>
                {initial ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="source"
                      checked={source === 'current'}
                      onChange={() => setSource('current')}
                    />
                    Manter a atual{initial.filterLabel ? ` (${initial.filterLabel})` : ''}
                  </label>
                ) : null}
                {fromList ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="source"
                      checked={source === 'list'}
                      onChange={() => setSource('list')}
                    />
                    Filtro da lista de leads
                  </label>
                ) : null}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="source"
                    checked={source === 'view'}
                    disabled={options.views.length === 0}
                    onChange={() => setSource('view')}
                  />
                  Visão salva
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="source"
                    checked={source === 'all'}
                    onChange={() => setSource('all')}
                  />
                  Todos os leads ativos
                </label>
              </fieldset>
              {source === 'view' ? (
                <Field label="Visão salva" htmlFor="campaignView">
                  <Select
                    id="campaignView"
                    value={viewId}
                    onChange={(e) => setViewId(e.target.value)}
                  >
                    {options.views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {count
                  ? `Hoje: ${count.total.toLocaleString('pt-BR')} leads · ${count.contactable.toLocaleString('pt-BR')} contactáveis (prévia; a elegibilidade é avaliada ao montar).`
                  : 'Contando…'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Abordagem e distribuição</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Field
                label="Canal"
                htmlFor="campaignChannel"
                hint="O lead precisa de contato liberado neste canal."
              >
                <Select
                  id="campaignChannel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as Channel)}
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {GATE_CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cadência" htmlFor="campaignCadence">
                <Select
                  id="campaignCadence"
                  value={cadenceId}
                  onChange={(e) => setCadenceId(e.target.value)}
                >
                  <option value="">A padrão</option>
                  {options.cadences.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isDefault ? ' (padrão)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Sem contato há pelo menos (dias)"
                htmlFor="campaignMinDays"
                hint="Regra de frequência; 0 desliga."
              >
                <Input
                  id="campaignMinDays"
                  type="number"
                  min={0}
                  max={365}
                  value={minDays}
                  onChange={(e) => setMinDays(Number(e.target.value))}
                />
              </Field>
              <fieldset className="space-y-2 md:col-span-3">
                <legend className="text-sm font-medium">SDRs da campanha</legend>
                <p className="text-xs text-muted-foreground">
                  Lead que já é de um SDR da campanha fica com ele; os sem responsável são
                  distribuídos por carga, dos de maior score para os de menor. Lead de outra pessoa
                  fica de fora.
                </p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {sdrsAvailable.map((sdr) => (
                    <label key={sdr.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sdrIds.includes(sdr.id)}
                        onChange={() => toggleSdr(sdr.id)}
                      />
                      {sdr.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2 md:col-span-3">
                <legend className="text-sm font-medium">Abordagens (teste A/B, opcional)</legend>
                <p className="text-xs text-muted-foreground">
                  Com duas ou mais, cada SDR recebe as variantes alternadas. A comparação só aparece
                  com 30 contatados por variante, e a decisão é sempre do gestor.
                </p>
                {approachIds.map((id, index) => (
                  <div key={VARIANT_LABELS[index]} className="flex items-center gap-2">
                    <span className="w-20 text-sm text-muted-foreground">
                      Variante {VARIANT_LABELS[index]}
                    </span>
                    <Select
                      aria-label={`Abordagem da variante ${VARIANT_LABELS[index]}`}
                      value={id}
                      onChange={(e) => setVariant(index, e.target.value)}
                    >
                      <option value="">Escolha…</option>
                      {options.approaches.map((a) => (
                        <option
                          key={a.id}
                          value={a.id}
                          disabled={approachIds.includes(a.id) && a.id !== id}
                        >
                          {a.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Tirar a variante ${VARIANT_LABELS[index]}`}
                      onClick={() => setApproachIds(approachIds.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                {approachIds.length < MAX_CAMPAIGN_VARIANTS && options.approaches.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setApproachIds([...approachIds, ''])}
                  >
                    <Plus /> Adicionar abordagem
                  </Button>
                ) : null}
              </fieldset>
            </CardContent>
          </Card>
        </>
      )}

      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(initial ? `/campanhas/${initial.id}` : '/campanhas')}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {editing ? 'Salvar' : 'Criar rascunho'}
        </Button>
      </div>
    </form>
  );
}
