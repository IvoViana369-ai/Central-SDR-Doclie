/**
 * Reunião na agenda (F12-05; docs/INTEGRATIONS.md §12): link de modelo do
 * Google Agenda (a pessoa confirma na própria conta, sem OAuth nem acesso do
 * sistema à agenda) e arquivo .ics (RFC 5545) para qualquer calendário. O texto
 * leva o título, o escritório e o link da ficha, sem telefone ou e-mail.
 */

export const MEETING_DEFAULT_MINUTES = 30;

export interface CalendarEvent {
  /** Identificador estável (o mesmo evento atualiza em vez de duplicar). */
  uid: string;
  title: string;
  start: Date;
  end: Date;
  details?: string | null;
  url?: string | null;
}

/** 2026-10-14T13:00:00.000Z → 20261014T130000Z */
function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function fullDetails(event: CalendarEvent): string {
  return [event.details?.trim(), event.url ? `Ficha: ${event.url}` : null]
    .filter(Boolean)
    .join('\n\n');
}

export function googleCalendarLink(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${utcStamp(event.start)}/${utcStamp(event.end)}`,
    details: fullDetails(event),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escape de texto do iCalendar (\, ; , e quebras de linha). */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Dobra linhas com mais de 75 octetos (continuação começa com espaço). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const charSize = new TextEncoder().encode(char).length;
    if (size + charSize > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent, now: Date): string {
  const details = fullDetails(event);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Docline SDR//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(details ? [`DESCRIPTION:${icsText(details)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Reunião de uma tarefa: título com o escritório, 30 minutos a partir do prazo. */
export function meetingEvent(input: {
  taskId: string;
  title: string;
  description?: string | null;
  dueAt: Date;
  lead: { id: string; displayName: string };
  appUrl: string;
}): CalendarEvent {
  return {
    uid: `task-${input.taskId}@docline-sdr`,
    title: `${input.title} — ${input.lead.displayName}`,
    start: input.dueAt,
    end: new Date(input.dueAt.getTime() + MEETING_DEFAULT_MINUTES * 60_000),
    details: input.description ?? null,
    url: `${input.appUrl.replace(/\/$/, '')}/leads/${input.lead.id}`,
  };
}
