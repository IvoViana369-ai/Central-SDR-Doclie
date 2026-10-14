import {
  isWithinWindow,
  localParts,
  nextWindowOpening,
  formatHhmm,
  type BusinessCalendar,
} from '../../../shared/calendar';

/**
 * Limites de horário e de frequência do gate (docs/SDR-FLOW.md §6 e §9;
 * F5-08): nenhum contato fora da janela, intervalo mínimo entre contatos ao
 * mesmo lead (responder a quem escreveu não conta) e máximo de primeiros
 * contatos por SDR por dia. Diferente dos bloqueios do gate, estes passam com o
 * tempo: o resultado diz a partir de quando o contato fica liberado.
 */

export interface ContactTimingInput {
  now: Date;
  /** Calendário do lead (fuso, feriados e janela). */
  calendar: BusinessCalendar;
  lastContactAt: Date | null;
  lastInboundAt: Date | null;
  minHoursBetweenContacts: number;
  /** O contato será o primeiro do lead. */
  firstContact: boolean;
  /** Primeiros contatos que o SDR já fez hoje. */
  firstContactsToday: number;
  maxFirstContactsPerDay: number;
}

export interface ContactTimingResult {
  allowed: boolean;
  reasons: string[];
  /** Quando o contato fica liberado (só com bloqueio de tempo). */
  availableAt: Date | null;
}

const HOUR_MS = 3_600_000;
const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function formatLocal(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${DAY_LABELS[p.weekday]} ${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} às ${formatHhmm(p.minutes)}`;
}

export function evaluateContactTiming(input: ContactTimingInput): ContactTimingResult {
  const { now, calendar } = input;
  const reasons: string[] = [];
  let availableAt: Date | null = null;
  const later = (date: Date) => {
    if (!availableAt || date > availableAt) availableAt = date;
  };

  if (!isWithinWindow(now, calendar)) {
    const opening = nextWindowOpening(now, calendar);
    reasons.push(
      `Fora da janela de contato (${formatHhmm(calendar.windowStart)}–${formatHhmm(calendar.windowEnd)} no horário do lead). Próxima abertura: ${formatLocal(opening, calendar.timeZone)}.`,
    );
    later(opening);
  }

  // Quem respondeu depois do último contato pode ser respondido a qualquer momento da janela.
  const replyPending =
    input.lastInboundAt !== null &&
    (input.lastContactAt === null || input.lastInboundAt > input.lastContactAt);
  if (input.lastContactAt && !replyPending && input.minHoursBetweenContacts > 0) {
    const free = new Date(input.lastContactAt.getTime() + input.minHoursBetweenContacts * HOUR_MS);
    if (free > now) {
      const opening = nextWindowOpening(free, calendar);
      reasons.push(
        `Último contato há menos de ${input.minHoursBetweenContacts} h. Próximo contato a partir de ${formatLocal(opening, calendar.timeZone)}.`,
      );
      later(opening);
    }
  }

  if (input.firstContact && input.firstContactsToday >= input.maxFirstContactsPerDay) {
    reasons.push(
      `Limite de ${input.maxFirstContactsPerDay} primeiros contatos por dia atingido. Retome amanhã.`,
    );
    const p = localParts(now, calendar.timeZone);
    // Amanhã, na abertura da janela (calculada a partir do fim do dia local).
    const endOfDay = new Date(now.getTime() + (24 * 60 - p.minutes) * 60_000);
    later(nextWindowOpening(endOfDay, calendar));
  }

  return { allowed: reasons.length === 0, reasons, availableAt };
}
