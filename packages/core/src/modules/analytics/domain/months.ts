import { DEFAULT_TIME_ZONE, zonedTime } from '../../../shared/calendar';
import { ValidationError } from '../../../shared/errors';
import { todayIn } from './period';

/**
 * Meses da evolução mensal (F11-02): "AAAA-MM" no fuso da operação, fim
 * inclusivo; padrão: os últimos 12 meses (o atual incluído, ainda parcial).
 */

export const DEFAULT_MONTHS = 12;
export const MAX_MONTHS = 36;

const MONTH = /^(\d{4})-(\d{2})$/;

export interface MonthRange {
  from: string;
  to: string;
  months: string[];
  start: Date;
  end: Date;
  timeZone: string;
}

const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** "out/2026" a partir de "2026-10". */
export function monthLabel(month: string): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  return `${MONTH_NAMES[Number(match[2]) - 1]}/${match[1]}`;
}

function parseMonth(value: string): { year: number; month: number } | null {
  const match = MONTH.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

const index = (m: { year: number; month: number }) => m.year * 12 + (m.month - 1);
const fromIndex = (i: number) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
const key = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, '0')}`;

export function resolveMonths(
  input: { from?: string | null; to?: string | null },
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): MonthRange {
  const today = todayIn(now, timeZone);
  const to = input.to ? parseMonth(input.to) : { year: today.year, month: today.month };
  if (!to) throw new ValidationError([{ path: 'to', message: 'Mês final inválido (AAAA-MM).' }]);
  const from = input.from ? parseMonth(input.from) : fromIndex(index(to) - (DEFAULT_MONTHS - 1));
  if (!from) {
    throw new ValidationError([{ path: 'from', message: 'Mês inicial inválido (AAAA-MM).' }]);
  }
  const length = index(to) - index(from) + 1;
  if (length < 1) {
    throw new ValidationError([{ path: 'from', message: 'O mês inicial é depois do final.' }]);
  }
  if (length > MAX_MONTHS) {
    throw new ValidationError([{ path: 'from', message: `São no máximo ${MAX_MONTHS} meses.` }]);
  }
  const after = fromIndex(index(to) + 1);
  return {
    from: key(from),
    to: key(to),
    months: Array.from({ length }, (_, i) => key(fromIndex(index(from) + i))),
    start: zonedTime({ ...from, day: 1 }, 0, timeZone),
    end: zonedTime({ ...after, day: 1 }, 0, timeZone),
    timeZone,
  };
}
