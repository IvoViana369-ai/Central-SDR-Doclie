import {
  addDays,
  DEFAULT_TIME_ZONE,
  isoDate,
  localParts,
  zonedTime,
  type LocalDate,
} from '../../../shared/calendar';
import { ValidationError } from '../../../shared/errors';

/**
 * Período dos indicadores (docs/SDR-FLOW.md §11): datas locais inclusivas no
 * fuso da operação. `start`/`end` são os instantes (fim exclusivo) usados nas
 * consultas; `days` lista cada dia, para a evolução diária.
 */

export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_PERIOD_DAYS = 366;

export interface AnalyticsPeriod {
  from: string;
  to: string;
  start: Date;
  end: Date;
  days: string[];
  timeZone: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDay(value: string): LocalDate | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  // Recusa datas que não existem (ex.: 2026-02-30).
  return isoDate(addDays(date, 0)) === value ? date : null;
}

export function todayIn(now: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalDate {
  const local = localParts(now, timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

const dayNumber = (d: LocalDate) => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

export function resolvePeriod(
  input: { from?: string | null; to?: string | null },
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): AnalyticsPeriod {
  const today = todayIn(now, timeZone);
  const to = input.to ? parseIsoDay(input.to) : today;
  if (!to) throw new ValidationError([{ path: 'to', message: 'Data final inválida.' }]);
  const from = input.from ? parseIsoDay(input.from) : addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  if (!from) throw new ValidationError([{ path: 'from', message: 'Data inicial inválida.' }]);
  const length = dayNumber(to) - dayNumber(from) + 1;
  if (length < 1) {
    throw new ValidationError([{ path: 'from', message: 'A data inicial é depois da final.' }]);
  }
  if (length > MAX_PERIOD_DAYS) {
    throw new ValidationError([
      { path: 'from', message: `O período pode ter no máximo ${MAX_PERIOD_DAYS} dias.` },
    ]);
  }
  return {
    from: isoDate(from),
    to: isoDate(to),
    start: zonedTime(from, 0, timeZone),
    end: zonedTime(addDays(to, 1), 0, timeZone),
    days: Array.from({ length }, (_, i) => isoDate(addDays(from, i))),
    timeZone,
  };
}

export const PERIOD_PRESETS = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: '90d', label: 'Últimos 90 dias' },
  { key: 'mes', label: 'Este mês' },
  { key: 'mes-anterior', label: 'Mês passado' },
] as const;

export type PeriodPresetKey = (typeof PERIOD_PRESETS)[number]['key'];

/** Datas de um atalho de período, relativas a hoje no fuso. */
export function presetRange(
  key: PeriodPresetKey,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): { from: string; to: string } {
  const today = todayIn(now, timeZone);
  const back = (days: number) => ({
    from: isoDate(addDays(today, -(days - 1))),
    to: isoDate(today),
  });
  switch (key) {
    case 'hoje':
      return back(1);
    case '7d':
      return back(7);
    case '30d':
      return back(30);
    case '90d':
      return back(90);
    case 'mes':
      return { from: isoDate({ ...today, day: 1 }), to: isoDate(today) };
    case 'mes-anterior': {
      const lastOfPrevious = addDays({ ...today, day: 1 }, -1);
      return { from: isoDate({ ...lastOfPrevious, day: 1 }), to: isoDate(lastOfPrevious) };
    }
  }
}

/** Atalho que corresponde ao período, se houver (para marcar o filtro ativo). */
export function matchPreset(
  period: { from: string; to: string },
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): PeriodPresetKey | null {
  for (const preset of PERIOD_PRESETS) {
    const range = presetRange(preset.key, now, timeZone);
    if (range.from === period.from && range.to === period.to) return preset.key;
  }
  return null;
}
