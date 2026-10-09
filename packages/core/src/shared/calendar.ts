/**
 * Calendário útil no fuso do lead (docs/SDR-FLOW.md §4.2): dias úteis,
 * feriados e janela de contato. Funções puras: quem chama carrega os feriados
 * e as regras e passa o instante atual.
 */

export const DEFAULT_TIME_ZONE = 'America/Fortaleza';

/** Dia da semana como no `Date#getDay`: 0 = domingo … 6 = sábado. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BusinessCalendar {
  timeZone: string;
  /** Janela de contato em minutos desde a meia-noite local (480 = 08:00). */
  windowStart: number;
  windowEnd: number;
  /** Dias da semana com expediente. */
  workDays: readonly number[];
  /** Feriados no formato `AAAA-MM-DD` (data local). */
  holidays: ReadonlySet<string>;
  /** Conta prazos em dias úteis (padrão) ou corridos. */
  useBusinessDays: boolean;
}

/** Data local (sem hora). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE_MS = 60_000;

/** "08:30" → 510. "24:00" (fim da janela = fim do dia) → 1440. */
export function parseHhmm(value: string): number {
  if (value === '24:00') return 24 * 60;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Horário inválido: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 510 → "08:30". */
export function formatHhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Data, dia da semana e minuto do dia de um instante no fuso. */
export function localParts(
  instant: Date,
  timeZone: string,
): LocalDate & { weekday: Weekday; minutes: number; seconds: number } {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday!]!,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

/** Diferença (ms) entre a hora local do fuso e o UTC naquele instante. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes, p.seconds);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante de uma data e hora local no fuso (ex.: 08:00 em Fortaleza). */
export function zonedTime(date: LocalDate, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  // Duas passagens acertam a hora mesmo perto de uma mudança de horário de verão.
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** "AAAA-MM-DD". */
export function isoDate(date: LocalDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Dia de expediente: dia da semana com trabalho e sem feriado. */
export function isWorkDay(date: LocalDate, calendar: BusinessCalendar): boolean {
  return calendar.workDays.includes(weekdayOf(date)) && !calendar.holidays.has(isoDate(date));
}

/** Próximo dia de expediente a partir de `date` (inclusive). */
export function nextWorkDay(date: LocalDate, calendar: BusinessCalendar): LocalDate {
  let current = date;
  // Um ano basta mesmo com uma configuração sem dias úteis por engano.
  for (let i = 0; i < 366; i++) {
    if (isWorkDay(current, calendar)) return current;
    current = addDays(current, 1);
  }
  throw new Error('Calendário sem dias úteis: confira os dias de expediente.');
}

/**
 * Soma dias ao dia local: úteis (pulando fins de semana e feriados) ou
 * corridos, conforme o calendário. O resultado sempre cai em dia de expediente.
 */
export function addWorkDays(date: LocalDate, days: number, calendar: BusinessCalendar): LocalDate {
  if (!calendar.useBusinessDays) return nextWorkDay(addDays(date, days), calendar);
  let current = nextWorkDay(date, calendar);
  for (let added = 0; added < days; added++) {
    current = nextWorkDay(addDays(current, 1), calendar);
  }
  return current;
}

/** O instante está dentro da janela de contato, num dia de expediente? */
export function isWithinWindow(instant: Date, calendar: BusinessCalendar): boolean {
  const local = localParts(instant, calendar.timeZone);
  return (
    isWorkDay(local, calendar) &&
    local.minutes >= calendar.windowStart &&
    local.minutes < calendar.windowEnd
  );
}

/**
 * Próximo instante de contato permitido: o próprio instante, se estiver na
 * janela; senão, o início da janela no próximo dia de expediente.
 */
export function nextWindowOpening(instant: Date, calendar: BusinessCalendar): Date {
  if (isWithinWindow(instant, calendar)) return instant;
  const local = localParts(instant, calendar.timeZone);
  const today: LocalDate = { year: local.year, month: local.month, day: local.day };
  const day =
    isWorkDay(today, calendar) && local.minutes < calendar.windowStart
      ? today
      : nextWorkDay(addDays(today, 1), calendar);
  return zonedTime(day, calendar.windowStart, calendar.timeZone);
}

/**
 * Vencimento de algo previsto para `days` dias depois de `from` (dias úteis ou
 * corridos): no início da janela daquele dia. Com zero dias, vence agora, se
 * estiver na janela, ou na próxima abertura.
 */
export function dueAfter(from: Date, days: number, calendar: BusinessCalendar): Date {
  if (days <= 0) return nextWindowOpening(from, calendar);
  const local = localParts(from, calendar.timeZone);
  const target = addWorkDays(
    { year: local.year, month: local.month, day: local.day },
    days,
    calendar,
  );
  return zonedTime(target, calendar.windowStart, calendar.timeZone);
}

/** Início e fim (exclusivo) do dia local de um instante, para contagens "de hoje". */
export function localDayBounds(instant: Date, timeZone: string): { start: Date; end: Date } {
  const local = localParts(instant, timeZone);
  const today: LocalDate = { year: local.year, month: local.month, day: local.day };
  return {
    start: zonedTime(today, 0, timeZone),
    end: zonedTime(addDays(today, 1), 0, timeZone),
  };
}

/** Diferença em dias inteiros (para "dias de atraso"). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * MINUTE_MS));
}
