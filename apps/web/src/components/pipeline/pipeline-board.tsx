'use client';

import { checkTransition } from '@docline/core/pipeline-domain';
import { SCORE_BAND_LABELS } from '@docline/core/scoring-domain';
import { AtSign, CalendarClock, MessageCircle, MoveRight, Search } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from 'react';
import {
  MunicipalityPicker,
  type MunicipalityOption,
} from '@/components/leads/municipality-picker';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';
import {
  CONFLICT_MESSAGE,
  MoveStageDialog,
  type MoveResult,
  type MoveTarget,
} from './move-stage-dialog';
import {
  ScoreBadge,
  StageDot,
  type LossReasonView,
  type ScoreBand,
  type StageView,
} from './pipeline-ui';

export interface BoardCard {
  id: string;
  code: string;
  version: number;
  displayName: string;
  city: string | null;
  stateUf: string | null;
  score: number | null;
  scoreBand: ScoreBand | null;
  ownerName: string | null;
  daysInStage: number;
  overdue: boolean;
  nextActionAt: string | Date | null;
  nextActionOverdue: boolean;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  doNotContact: boolean;
}

export interface BoardColumn {
  stage: StageView;
  count: number;
  cards: BoardCard[];
  nextCursor: number | null;
}

export interface BoardData {
  pipeline: { id: string; name: string };
  columns: BoardColumn[];
  total: number;
}

interface BoardFilters {
  q: string;
  owner: string;
  state: string;
  city: MunicipalityOption | null;
  band: string;
  origin: string;
  tag: string;
}

const EMPTY: BoardFilters = {
  q: '',
  owner: '',
  state: '',
  city: null,
  band: '',
  origin: '',
  tag: '',
};

type Condition = { field: string; op: string; value: unknown };

/** Abaixo do breakpoint `md` do Tailwind, o quadro vira lista por etapa. */
const MOBILE_QUERY = '(max-width: 767px)';

function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Só uma das versões fica no DOM (no servidor, a de desktop). */
function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/** Card sendo arrastado e a coluna de onde saiu. */
type Dragging = { card: BoardCard; from: StageView };

/** Filtros do quadro (SDR-FLOW §3.3) → DSL da lista de leads. */
function toSelection(f: BoardFilters): { filter?: { all: Condition[] }; q?: string } {
  const all: Condition[] = [];
  if (f.owner === 'none') all.push({ field: 'owner', op: 'isNull', value: true });
  else if (f.owner) all.push({ field: 'owner', op: 'eq', value: f.owner });
  if (f.state) all.push({ field: 'state', op: 'eq', value: f.state });
  if (f.city) all.push({ field: 'city', op: 'eq', value: f.city.ibgeCode });
  if (f.band) all.push({ field: 'scoreBand', op: 'eq', value: f.band });
  if (f.origin) all.push({ field: 'origin', op: 'eq', value: f.origin });
  if (f.tag) all.push({ field: 'tags', op: 'hasAny', value: [f.tag] });
  return {
    ...(all.length > 0 ? { filter: { all } } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
  };
}

/** Insere o card na posição de prioridade da coluna (maior score primeiro). */
function insertByScore(cards: BoardCard[], card: BoardCard): BoardCard[] {
  const rank = (c: BoardCard) => c.score ?? -1;
  const index = cards.findIndex((c) => rank(c) < rank(card));
  return index === -1 ? [...cards, card] : [...cards.slice(0, index), card, ...cards.slice(index)];
}

function daysLabel(days: number) {
  if (days === 0) return 'Entrou hoje';
  return days === 1 ? '1 dia na etapa' : `${days} dias na etapa`;
}

/**
 * Pipeline Kanban (MVP M08; docs/SDR-FLOW.md §3): colunas com contagem, cards
 * por prioridade, arrastar e soltar com as regras de transição, motivo de perda
 * e lock otimista. No celular, lista por etapa com seletor (sem arrastar).
 */
export function PipelineBoard({
  initial,
  lossReasons,
  options,
  permissions,
}: {
  initial: BoardData;
  lossReasons: LossReasonView[];
  options: {
    states: { uf: string; name: string }[];
    sources: { key: string; name: string }[];
    tags: { id: string; name: string }[];
    owners?: { id: string; name: string }[];
  };
  permissions: { canMove: boolean; privileged: boolean };
}) {
  const [board, setBoard] = useState<BoardData>(initial);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [dragging, setDraggingState] = useState<Dragging | null>(null);
  // Lido no dragover/drop, que podem chegar antes do novo render.
  const draggingRef = useRef<Dragging | null>(null);
  const setDragging = (value: Dragging | null) => {
    draggingRef.current = value;
    setDraggingState(value);
  };
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [clearCount, setClearCount] = useState(0);
  const [mobileStageId, setMobileStageId] = useState(
    () => (initial.columns.find((c) => c.count > 0) ?? initial.columns[0])?.stage.id ?? '',
  );
  const requestId = useRef(0);
  const reloading = useRef(false);
  /** Movimentos enviados e ainda sem resposta do servidor. */
  const pendingMoves = useRef(0);
  const needsReload = useRef(false);
  const firstRender = useRef(true);
  const isMobile = useIsMobile();

  const selection = useMemo(() => toSelection(filters), [filters]);
  const stages = useMemo(() => board.columns.map((c) => c.stage), [board.columns]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    reloading.current = true;
    setLoading(true);
    try {
      const next = await api<BoardData>('/pipelines/default/board', {
        method: 'POST',
        body: selection,
      });
      if (id !== requestId.current) return;
      // Com um movimento em curso, o quadro lido pode ser o de antes dele.
      if (pendingMoves.current > 0) needsReload.current = true;
      else setBoard(next);
    } catch (err) {
      if (id === requestId.current) {
        setNotice({
          variant: 'error',
          text: err instanceof ApiError ? err.message : 'Falha ao carregar o quadro.',
        });
      }
    } finally {
      if (id === requestId.current) {
        reloading.current = false;
        setLoading(false);
      }
    }
  }, [selection]);

  // Recarrega quando os filtros mudam (a busca livre espera a digitação parar).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => void reload(), filters.q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega só quando a seleção muda
  }, [selection]);

  const set = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  async function loadMore(column: BoardColumn) {
    if (column.nextCursor === null) return;
    try {
      const page = await api<{ cards: BoardCard[]; nextCursor: number | null }>(
        '/pipelines/default/board/cards',
        {
          method: 'POST',
          body: { ...selection, stageId: column.stage.id, cursor: column.nextCursor },
        },
      );
      setBoard((b) => ({
        ...b,
        columns: b.columns.map((c) =>
          c.stage.id === column.stage.id
            ? {
                ...c,
                cards: [
                  ...c.cards,
                  ...page.cards.filter((p) => !c.cards.some((x) => x.id === p.id)),
                ],
                nextCursor: page.nextCursor,
              }
            : c,
        ),
      }));
    } catch (err) {
      setNotice({
        variant: 'error',
        text: err instanceof ApiError ? err.message : 'Falha ao carregar mais leads.',
      });
    }
  }

  /** Atualiza o quadro na hora (o servidor confirma em seguida). */
  function applyLocalMove(card: BoardCard, fromId: string, toId: string, version: number) {
    const moved = { ...card, version, daysInStage: 0, overdue: false };
    setBoard((b) => ({
      ...b,
      columns: b.columns.map((c) => {
        if (c.stage.id === fromId) {
          return { ...c, count: c.count - 1, cards: c.cards.filter((x) => x.id !== card.id) };
        }
        if (c.stage.id === toId) {
          return { ...c, count: c.count + 1, cards: insertByScore(c.cards, moved) };
        }
        return c;
      }),
    }));
  }

  async function moveDirect(card: BoardCard, from: StageView, to: StageView) {
    setNotice(null);
    pendingMoves.current += 1;
    if (reloading.current) {
      // A recarga em curso (ex.: filtro recém-digitado) traria o quadro de antes
      // do movimento: é descartada e refeita quando o servidor confirmar.
      requestId.current += 1;
      needsReload.current = true;
    }
    applyLocalMove(card, from.id, to.id, card.version);
    try {
      const result = await api<MoveResult>(`/leads/${card.id}/stage`, {
        method: 'POST',
        body: { stageId: to.id, version: card.version },
      });
      setBoard((b) => ({
        ...b,
        columns: b.columns.map((c) =>
          c.stage.id === to.id
            ? {
                ...c,
                cards: c.cards.map((x) =>
                  x.id === card.id ? { ...x, version: result.version } : x,
                ),
              }
            : c,
        ),
      }));
      setNotice({ variant: 'success', text: `${card.displayName} → ${to.name}.` });
    } catch (err) {
      // O card volta: o quadro é recarregado com o estado do servidor.
      setNotice({
        variant: 'error',
        text:
          err instanceof ApiError && err.status === 409
            ? CONFLICT_MESSAGE
            : err instanceof ApiError
              ? err.message
              : 'Não foi possível mover o lead.',
      });
      needsReload.current = true;
    } finally {
      pendingMoves.current -= 1;
      if (pendingMoves.current === 0 && needsReload.current) {
        needsReload.current = false;
        void reload();
      }
    }
  }

  const allowedDrop = (to: StageView, current: Dragging | null) =>
    current !== null &&
    current.from.id !== to.id &&
    checkTransition({
      from: current.from,
      to,
      privileged: permissions.privileged,
      lossReasonGiven: true,
    }).ok;

  function onDrop(event: DragEvent, to: StageView) {
    event.preventDefault();
    setDropStageId(null);
    const current = draggingRef.current;
    setDragging(null);
    if (!current || !allowedDrop(to, current)) return;
    if (to.category === 'LOST') {
      // Perda pede o motivo antes de gravar.
      setMoveTarget({
        lead: { ...current.card, stageId: current.from.id },
        stageId: to.id,
      });
      return;
    }
    void moveDirect(current.card, current.from, to);
  }

  /** Coluna ou área de desfecho que aceita o card arrastado. */
  const dropHandlers = (stage: StageView) => ({
    onDragOver: (e: DragEvent) => {
      if (!allowedDrop(stage, draggingRef.current)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropStageId(stage.id);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropStageId(null);
    },
    onDrop: (e: DragEvent) => onDrop(e, stage),
  });

  // Desfechos (perdas e conversão) ficam no fim de um funil longo: durante o
  // arraste, aparecem também numa barra fixa, sem precisar rolar até a coluna.
  const outcomeStages = stages.filter(
    (s) => (s.category === 'LOST' || s.category === 'WON') && s.active,
  );

  const openMove = (card: BoardCard, stage: StageView) =>
    setMoveTarget({ lead: { ...card, stageId: stage.id } });

  const renderCard = (card: BoardCard, stage: StageView, draggable: boolean) => (
    <article
      key={card.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging({ card, from: stage });
      }}
      onDragEnd={() => {
        setDragging(null);
        setDropStageId(null);
      }}
      data-lead-card={card.displayName}
      className={cn(
        'rounded-lg border bg-card p-3 text-sm shadow-xs',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging?.card.id === card.id && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${card.id}`} className="font-medium leading-tight hover:underline">
          {card.displayName}
        </Link>
        {permissions.canMove ? (
          <Button
            size="icon"
            variant="ghost"
            className="-mr-1 -mt-1 size-7"
            aria-label={`Mover ${card.displayName}`}
            onClick={() => openMove(card, stage)}
          >
            <MoveRight />
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {card.code}
        {card.city ? ` · ${card.city}/${card.stateUf}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ScoreBadge score={card.score} band={card.scoreBand} />
        {card.doNotContact ? <Badge variant="destructive">Não contatar</Badge> : null}
        {card.hasWhatsapp ? (
          <MessageCircle
            className="size-3.5 text-muted-foreground"
            role="img"
            aria-label="Tem WhatsApp"
          />
        ) : null}
        {card.hasInstagram ? (
          <AtSign
            className="size-3.5 text-muted-foreground"
            role="img"
            aria-label="Tem Instagram"
          />
        ) : null}
      </div>
      {card.nextActionAt ? (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-xs',
            card.nextActionOverdue ? 'font-medium text-destructive' : 'text-muted-foreground',
          )}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Próxima ação: {formatDateTime(card.nextActionAt)}
          {card.nextActionOverdue ? ' (atrasada)' : ''}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{card.ownerName ?? 'Sem responsável'}</span>
        <span className={cn('shrink-0', card.overdue && 'font-medium text-destructive')}>
          {daysLabel(card.daysInStage)}
          {card.overdue ? ' · SLA' : ''}
        </span>
      </div>
    </article>
  );

  const mobileColumn = board.columns.find((c) => c.stage.id === mobileStageId) ?? board.columns[0];

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Leads do seu escopo por etapa, do maior score para o menor. Arraste o card ou use o botão de mover."
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
            aria-label="Buscar no pipeline"
            placeholder="Buscar por nome, código, CNPJ, telefone, e-mail ou @instagram"
            className="pl-9"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          <div>
            <label htmlFor="boardCity" className="sr-only">
              Cidade
            </label>
            {/* A chave zera o texto digitado ao limpar os filtros. */}
            <MunicipalityPicker
              key={clearCount}
              id="boardCity"
              value={filters.city}
              onChange={(city) => set('city', city)}
            />
          </div>
          <Select
            aria-label="Faixa de score"
            value={filters.band}
            onChange={(e) => set('band', e.target.value)}
          >
            <option value="">Qualquer faixa</option>
            {Object.entries(SCORE_BAND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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
          <Select aria-label="Tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)}>
            <option value="">Qualquer tag</option>
            {options.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <p aria-live="polite" data-testid="pipeline-total">
            <strong>{board.total}</strong> leads no funil
            {loading ? <span className="text-muted-foreground"> · atualizando…</span> : null}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY);
              setClearCount((n) => n + 1);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </Card>

      {/* Celular: uma etapa por vez, sem arrastar (F4-04). */}
      {isMobile ? (
        <div className="space-y-3">
          <Select
            aria-label="Etapa"
            value={mobileColumn?.stage.id ?? ''}
            onChange={(e) => setMobileStageId(e.target.value)}
          >
            {board.columns.map((c) => (
              <option key={c.stage.id} value={c.stage.id}>
                {c.stage.name} ({c.count})
              </option>
            ))}
          </Select>
          {mobileColumn ? (
            <div className="space-y-2">
              {mobileColumn.cards.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum lead nesta etapa.
                </p>
              ) : (
                mobileColumn.cards.map((card) => renderCard(card, mobileColumn.stage, false))
              )}
              {mobileColumn.nextCursor !== null ? (
                <Button variant="outline" className="w-full" onClick={() => loadMore(mobileColumn)}>
                  Carregar mais
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        /* Desktop: Kanban com arrastar e soltar. */
        <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Quadro do pipeline">
          {board.columns.map((column) => {
            const { stage } = column;
            const blocked =
              dragging !== null && dragging.from.id !== stage.id && !allowedDrop(stage, dragging);
            return (
              <section
                key={stage.id}
                data-stage-key={stage.key}
                aria-label={`${stage.name}: ${column.count} leads`}
                {...dropHandlers(stage)}
                className={cn(
                  'flex max-h-[75vh] w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors',
                  dropStageId === stage.id && 'border-primary bg-accent',
                  blocked && 'opacity-40',
                )}
              >
                <header className="flex items-center gap-2 px-3 py-2">
                  <StageDot color={stage.color} />
                  <h2 className="truncate text-sm font-medium">{stage.name}</h2>
                  <span
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    data-testid="stage-count"
                  >
                    {column.count}
                  </span>
                </header>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {column.cards.map((card) => renderCard(card, stage, permissions.canMove))}
                  {column.count === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Vazia</p>
                  ) : null}
                </div>
                {column.nextCursor !== null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="m-2"
                    onClick={() => loadMore(column)}
                  >
                    Carregar mais ({column.count - column.cards.length})
                  </Button>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {dragging && !isMobile ? (
        <div
          className="fixed inset-x-0 bottom-4 z-40 flex justify-center gap-3 px-4"
          aria-label="Soltar em uma etapa de desfecho"
        >
          {outcomeStages
            .filter((stage) => allowedDrop(stage, dragging))
            .map((stage) => (
              <div
                key={stage.id}
                data-drop-zone={stage.key}
                {...dropHandlers(stage)}
                className={cn(
                  'flex items-center gap-2 rounded-xl border-2 border-dashed bg-card px-5 py-3 text-sm font-medium shadow-lg',
                  dropStageId === stage.id && 'border-primary bg-accent',
                )}
              >
                <StageDot color={stage.color} />
                {stage.name}
              </div>
            ))}
        </div>
      ) : null}

      {moveTarget ? (
        <MoveStageDialog
          key={`${moveTarget.lead.id}:${moveTarget.stageId ?? ''}`}
          target={moveTarget}
          stages={stages}
          lossReasons={lossReasons}
          privileged={permissions.privileged}
          onClose={() => setMoveTarget(null)}
          onMoved={(result) => {
            setMoveTarget(null);
            setNotice({
              variant: 'success',
              text: result.optedOut
                ? `${moveTarget.lead.displayName} → ${result.stageName}. O lead entrou na Lista Não Contatar.`
                : `${moveTarget.lead.displayName} → ${result.stageName}.`,
            });
            void reload();
          }}
          onConflict={(message) => {
            setMoveTarget(null);
            setNotice({ variant: 'error', text: message });
            void reload();
          }}
        />
      ) : null}
    </>
  );
}
