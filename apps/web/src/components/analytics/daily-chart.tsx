'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { fmtDate, fmtDay, fmtInt } from './format';

export interface DailyPoint {
  day: string;
  newLeads: number;
  firstContacts: number;
  replies: number;
}

const SERIES = [
  { key: 'newLeads', label: 'Novos leads', color: 'var(--chart-1)' },
  { key: 'firstContacts', label: 'Primeiros contatos', color: 'var(--chart-2)' },
  { key: 'replies', label: 'Responderam', color: 'var(--chart-3)' },
] as const;

const HEIGHT = 220;
const PAD = { top: 10, right: 12, bottom: 26, left: 36 };

/** Passo "redondo" (1, 2, 5 × 10ⁿ) para o eixo de contagens. */
function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/**
 * Evolução diária (M16): três séries de contagens no mesmo eixo, com legenda,
 * linha-guia com os valores do dia (mouse, toque ou setas do teclado) e a
 * tabela como alternativa acessível.
 */
export function DailyChart({ days }: { days: DailyPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(260, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [asTable]);

  const n = days.length;
  const max = Math.max(0, ...days.flatMap((d) => SERIES.map((s) => d[s.key])));
  const step = niceStep(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelCount = Math.max(2, Math.min(n, Math.floor(plotW / 56)));
  const labelAt = new Set(
    Array.from({ length: labelCount }, (_, i) =>
      Math.round((i * (n - 1)) / Math.max(1, labelCount - 1)),
    ),
  );

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left - PAD.left;
    const index = n <= 1 ? 0 : Math.round((px / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, index)));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    setActive((current) => Math.min(n - 1, Math.max(0, (current ?? n - 1) + delta)));
  };

  const point = active === null ? null : days[active];
  const tooltipLeft =
    active === null ? 0 : x(active) + 172 > width ? x(active) - 172 : x(active) + 12;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.label}
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Ver gráfico' : 'Ver tabela'}
        </Button>
      </div>

      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Dia</Th>
                {SERIES.map((s) => (
                  <Th key={s.key} className="text-right">
                    {s.label}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {days.map((d) => (
                <Tr key={d.day}>
                  <Td>{fmtDate(d.day)}</Td>
                  {SERIES.map((s) => (
                    <Td key={s.key} className="text-right tabular-nums">
                      {fmtInt(d[s.key])}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Evolução diária de ${fmtDate(days[0]?.day ?? '')} a ${fmtDate(days[n - 1]?.day ?? '')}. Use as setas para ver cada dia.`}
            tabIndex={0}
            className="block touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((current) => current ?? n - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKey}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 6}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {fmtInt(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              labelAt.has(i) ? (
                <text
                  key={d.day}
                  x={x(i)}
                  y={HEIGHT - 8}
                  textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {fmtDay(d.day)}
                </text>
              ) : null,
            )}
            {active !== null ? (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            ) : null}
            {SERIES.map((s) =>
              n > 1 ? (
                <path
                  key={s.key}
                  d={days
                    .map(
                      (d, i) =>
                        `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`,
                    )
                    .join('')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null,
            )}
            {SERIES.map((s) =>
              (active !== null ? [active] : n === 1 ? [0] : []).map((i) => (
                <circle
                  key={`${s.key}-${i}`}
                  cx={x(i)}
                  cy={y(days[i]![s.key])}
                  r={4}
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )),
            )}
          </svg>
          {point ? (
            <div
              className="pointer-events-none absolute top-2 w-40 rounded-md border bg-card p-2 text-xs shadow-md"
              style={{ left: tooltipLeft }}
              aria-live="polite"
            >
              <p className="mb-1 text-muted-foreground">{fmtDate(point.day)}</p>
              <ul className="space-y-0.5">
                {SERIES.map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-0.5 w-3 rounded-full"
                      style={{ background: s.color }}
                      aria-hidden
                    />
                    <span className="font-semibold tabular-nums">{fmtInt(point[s.key])}</span>
                    <span className="truncate text-muted-foreground">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {max === 0 ? (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">
              Sem movimento no período.
            </p>
          ) : null}
        </div>
      )}
    </figure>
  );
}
