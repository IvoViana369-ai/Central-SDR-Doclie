'use client';

import { CONTACT_STATUS_LABELS } from '@docline/core/compliance-domain';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { ChannelIcons, ContactStatusBadge, LeadStatusBadge, TagChip } from './badges';
import { BulkDialog, type BulkTarget } from './bulk-dialog';
import { TagsDialog } from './tags-dialog';

type ContactStatus = keyof typeof CONTACT_STATUS_LABELS;

export interface LeadRow {
  id: string;
  codeLabel: string;
  displayName: string;
  cityRaw: string | null;
  stateUf: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'MERGED' | 'ANONYMIZED';
  contactStatus: ContactStatus;
  hasPhone: boolean;
  hasWhatsapp: boolean;
  hasEmail: boolean;
  hasInstagram: boolean;
  hasWebsite: boolean;
  primaryPhone: string | null;
  lastActivityAt: string | Date;
  owner: { id: string; name: string } | null;
  tags: { id: string; name: string; color: string }[];
}

export interface LeadsPage {
  data: LeadRow[];
  nextCursor: string | null;
}

export interface LeadCount {
  total: number;
  contactable: number;
  blocked: number;
}

export interface SavedView {
  id: string;
  name: string;
  mine: boolean;
  filter: unknown;
  sort: unknown;
}

/** Estado dos controles de filtro; vira a DSL de filtros da API. */
export interface FilterState {
  q: string;
  state: string;
  contactStatus: string;
  owner: string;
  origin: string;
  segment: string;
  tag: string;
  status: string;
  hasWhatsapp: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasInstagram: boolean;
  sort: string;
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  state: '',
  contactStatus: '',
  owner: '',
  origin: '',
  segment: '',
  tag: '',
  status: 'ACTIVE',
  hasWhatsapp: false,
  hasPhone: false,
  hasEmail: false,
  hasInstagram: false,
  sort: 'recent_activity',
};

type Condition = { field: string; op: string; value: unknown };

/** Controles → DSL (docs/ARCHITECTURE.md §9.1). */
export function toSelection(f: FilterState): { filter?: { all: Condition[] }; q?: string } {
  const all: Condition[] = [];
  if (f.state) all.push({ field: 'state', op: 'eq', value: f.state });
  if (f.contactStatus) all.push({ field: 'contactStatus', op: 'eq', value: f.contactStatus });
  if (f.owner === 'none') all.push({ field: 'owner', op: 'isNull', value: true });
  else if (f.owner) all.push({ field: 'owner', op: 'eq', value: f.owner });
  if (f.origin) all.push({ field: 'origin', op: 'eq', value: f.origin });
  if (f.segment) all.push({ field: 'segment', op: 'eq', value: f.segment });
  if (f.tag) all.push({ field: 'tags', op: 'hasAny', value: [f.tag] });
  if (f.status && f.status !== 'ACTIVE') {
    all.push(
      f.status === 'ALL'
        ? { field: 'status', op: 'in', value: ['ACTIVE', 'ARCHIVED'] }
        : { field: 'status', op: 'eq', value: f.status },
    );
  }
  for (const key of ['hasWhatsapp', 'hasPhone', 'hasEmail', 'hasInstagram'] as const) {
    if (f[key]) all.push({ field: key, op: 'eq', value: true });
  }
  return {
    ...(all.length > 0 ? { filter: { all } } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
  };
}

/** Visão salva → controles (filtros fora dos controles simples são ignorados). */
function fromView(view: SavedView): FilterState {
  const stored = (view.filter ?? {}) as {
    filter?: { all?: Condition[] } | null;
    q?: string | null;
  };
  const next: FilterState = {
    ...EMPTY_FILTERS,
    q: stored.q ?? '',
    sort: String(view.sort ?? 'recent_activity'),
  };
  for (const c of stored.filter?.all ?? []) {
    if (c.field === 'state') next.state = String(c.value);
    if (c.field === 'contactStatus') next.contactStatus = String(c.value);
    if (c.field === 'owner') next.owner = c.op === 'isNull' ? 'none' : String(c.value);
    if (c.field === 'origin') next.origin = String(c.value);
    if (c.field === 'segment') next.segment = String(c.value);
    if (c.field === 'tags') next.tag = String((c.value as string[])[0] ?? '');
    if (c.field === 'status') next.status = c.op === 'in' ? 'ALL' : String(c.value);
    if (
      c.field === 'hasWhatsapp' ||
      c.field === 'hasPhone' ||
      c.field === 'hasEmail' ||
      c.field === 'hasInstagram'
    ) {
      next[c.field] = true;
    }
  }
  return next;
}

export function LeadsExplorer({
  initial,
  initialCount,
  options,
  permissions,
}: {
  initial: LeadsPage;
  initialCount: LeadCount;
  options: {
    states: { uf: string; name: string }[];
    sources: { key: string; name: string }[];
    segments: { key: string; name: string }[];
    tags: { id: string; name: string; color: string }[];
    owners?: { id: string; name: string }[];
    views: SavedView[];
  };
  permissions: { canCreate: boolean; canBulk: boolean; canAssign: boolean; canManageTags: boolean };
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [rows, setRows] = useState<LeadRow[]>(initial.data);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [count, setCount] = useState<LeadCount>(initialCount);
  const [views, setViews] = useState<SavedView[]>(options.views);
  const [viewId, setViewId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const firstRender = useRef(true);
  const requestId = useRef(0);

  const selection = useMemo(() => toSelection(filters), [filters]);

  const load = useCallback(
    async (append: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const [page, total] = await Promise.all([
          api<LeadsPage>('/leads/search', {
            method: 'POST',
            body: { ...selection, sort: filters.sort, ...(append && cursor ? { cursor } : {}) },
          }),
          append
            ? Promise.resolve(null)
            : api<LeadCount>('/leads/count', { method: 'POST', body: selection }),
        ]);
        if (id !== requestId.current) return;
        setRows((current) => (append ? [...current, ...page.data] : page.data));
        setCursor(page.nextCursor);
        if (total) setCount(total);
        if (!append) {
          setSelected(new Set());
          setAllMatching(false);
        }
      } catch (err) {
        if (id === requestId.current) {
          setNotice({
            variant: 'error',
            text: err instanceof ApiError ? err.message : 'Falha ao carregar.',
          });
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [selection, filters.sort, cursor],
  );

  // Recarrega quando os filtros mudam (a busca livre espera a digitação parar).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => void load(false), filters.q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega só quando a seleção muda
  }, [selection, filters.sort]);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setViewId('');
    setFilters((f) => ({ ...f, [key]: value }));
  };

  async function saveCurrentView() {
    const name = window.prompt('Nome da visão:');
    if (!name) return;
    try {
      const view = await api<SavedView>('/saved-views', {
        method: 'POST',
        body: { name, ...selection, sort: filters.sort },
      });
      setViews((list) => [...list, { ...view, mine: true }]);
      setViewId(view.id);
      setNotice({ variant: 'success', text: `Visão "${name}" salva.` });
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível salvar.',
      });
    }
  }

  const bulkTarget: BulkTarget = allMatching
    ? { mode: 'filter', ...selection }
    : { ids: [...selected] };
  const selectedCount = allMatching ? count.total : selected.size;
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        title="Leads"
        description="Escritórios e empresas prospectados. Só aparecem os leads do seu escopo."
        actions={
          <>
            {permissions.canManageTags ? <TagsDialog tags={options.tags} /> : null}
            {permissions.canCreate ? (
              <Button asChild>
                <Link href="/leads/novo">
                  <Plus /> Novo lead
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? (
        <Alert variant={notice.variant} className="mb-4">
          {notice.text}
        </Alert>
      ) : null}

      <Card className="mb-4 space-y-3 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar leads"
            placeholder="Buscar por nome, código, CNPJ, telefone, e-mail ou @instagram"
            className="pl-9"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            aria-label="UF"
            value={filters.state}
            onChange={(e) => set('state', e.target.value)}
          >
            <option value="">Todas as UFs</option>
            {options.states.map((s) => (
              <option key={s.uf} value={s.uf}>
                {s.uf} — {s.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Situação de contato"
            value={filters.contactStatus}
            onChange={(e) => set('contactStatus', e.target.value)}
          >
            <option value="">Qualquer situação</option>
            {Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Responsável"
            value={filters.owner}
            onChange={(e) => set('owner', e.target.value)}
          >
            <option value="">Qualquer responsável</option>
            <option value="me">Meus leads</option>
            <option value="none">Sem responsável (pool)</option>
            {options.owners?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Origem"
            value={filters.origin}
            onChange={(e) => set('origin', e.target.value)}
          >
            <option value="">Qualquer origem</option>
            {options.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Segmento"
            value={filters.segment}
            onChange={(e) => set('segment', e.target.value)}
          >
            <option value="">Qualquer segmento</option>
            {options.segments.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)}>
            <option value="">Qualquer tag</option>
            {options.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="ACTIVE">Ativos</option>
            <option value="ARCHIVED">Arquivados</option>
            <option value="ALL">Ativos e arquivados</option>
          </Select>
          <Select
            aria-label="Ordenar por"
            value={filters.sort}
            onChange={(e) => set('sort', e.target.value)}
          >
            <option value="recent_activity">Atividade recente</option>
            <option value="newest">Mais novos</option>
            <option value="oldest">Mais antigos</option>
            <option value="name">Nome</option>
            <option value="code">Código</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {(
            [
              ['hasWhatsapp', 'Com WhatsApp'],
              ['hasPhone', 'Com telefone'],
              ['hasEmail', 'Com e-mail'],
              ['hasInstagram', 'Com Instagram'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={(e) => set(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <span className="flex-1" />
          <Select
            aria-label="Visões salvas"
            className="w-auto"
            value={viewId}
            onChange={(e) => {
              const view = views.find((v) => v.id === e.target.value);
              setViewId(e.target.value);
              setFilters(view ? fromView(view) : EMPTY_FILTERS);
            }}
          >
            <option value="">Visões salvas…</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.mine ? '' : ' (compartilhada)'}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={saveCurrentView}>
            Salvar visão
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setViewId('');
              setFilters(EMPTY_FILTERS);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p aria-live="polite" data-testid="lead-count">
          <strong>{count.total}</strong> leads · {count.contactable} contactáveis · {count.blocked}{' '}
          bloqueados
          {loading ? <span className="text-muted-foreground"> · atualizando…</span> : null}
        </p>
        {permissions.canBulk && selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{selectedCount} selecionado(s)</span>
            {!allMatching && allOnPageSelected && count.total > rows.length ? (
              <Button variant="link" size="sm" onClick={() => setAllMatching(true)}>
                Selecionar todos os {count.total} do filtro
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              Ação em massa
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        <Table>
          <THead>
            <Tr>
              {permissions.canBulk ? (
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos da página"
                    checked={allOnPageSelected}
                    onChange={(e) => {
                      setAllMatching(false);
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set());
                    }}
                  />
                </Th>
              ) : null}
              <Th>Lead</Th>
              <Th className="hidden md:table-cell">Responsável</Th>
              <Th>Situação</Th>
              <Th className="hidden lg:table-cell">Canais</Th>
              <Th className="hidden lg:table-cell">Tags</Th>
              <Th className="hidden md:table-cell">Atividade</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nenhum lead encontrado.
                </Td>
              </Tr>
            ) : (
              rows.map((lead) => (
                <Tr key={lead.id}>
                  {permissions.canBulk ? (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${lead.displayName}`}
                        checked={allMatching || selected.has(lead.id)}
                        onChange={(e) => {
                          setAllMatching(false);
                          setSelected((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(lead.id);
                            else next.delete(lead.id);
                            return next;
                          });
                        }}
                      />
                    </Td>
                  ) : null}
                  <Td>
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.displayName}
                    </Link>{' '}
                    <LeadStatusBadge status={lead.status} />
                    <p className="text-xs text-muted-foreground">
                      {lead.codeLabel}
                      {lead.cityRaw ? ` · ${lead.cityRaw}/${lead.stateUf}` : ''}
                      {lead.primaryPhone ? ` · ${lead.primaryPhone}` : ''}
                    </p>
                  </Td>
                  <Td className="hidden md:table-cell">
                    {lead.owner?.name ?? <span className="text-muted-foreground">Pool</span>}
                  </Td>
                  <Td>
                    <ContactStatusBadge status={lead.contactStatus} />
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <ChannelIcons lead={lead} />
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {lead.tags.map((t) => (
                        <TagChip key={t.id} tag={t} />
                      ))}
                    </span>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {formatDateTime(lead.lastActivityAt)}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>

      {cursor ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => load(true)}>
            Carregar mais
          </Button>
        </div>
      ) : null}

      {permissions.canBulk ? (
        <BulkDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          target={bulkTarget}
          owners={permissions.canAssign ? options.owners : undefined}
          tags={options.tags}
          onDone={(message) => {
            setNotice({ variant: 'success', text: message });
            void load(false);
          }}
        />
      ) : null}
    </>
  );
}
