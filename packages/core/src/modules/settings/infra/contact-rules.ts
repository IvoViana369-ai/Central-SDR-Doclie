import type { DbTransaction } from '@docline/db';
import { DEFAULT_TIME_ZONE, parseHhmm, type BusinessCalendar } from '../../../shared/calendar';
import { CONTACT_RULES_KEY, resolveContactRules, type ContactRules } from '../domain/contact-rules';

/** Regras de contato vigentes (padrões do código quando não há linha gravada). */
export async function loadContactRules(tx: DbTransaction): Promise<ContactRules> {
  const row = await tx.appSetting.findUnique({ where: { key: CONTACT_RULES_KEY } });
  return resolveContactRules(row?.value);
}

/** Onde o lead está, para fuso e feriados. */
export interface LeadPlace {
  municipalityCode: number | null;
  stateUf: string | null;
}

/** Fuso do lead: o do município, o da UF ou o padrão (Fortaleza). */
export async function leadTimeZone(tx: DbTransaction, place: LeadPlace): Promise<string> {
  if (place.municipalityCode) {
    const municipality = await tx.municipality.findUnique({
      where: { ibgeCode: place.municipalityCode },
      select: { timezone: true },
    });
    if (municipality) return municipality.timezone;
  }
  if (place.stateUf) {
    const state = await tx.state.findUnique({
      where: { uf: place.stateUf },
      select: { timezone: true },
    });
    if (state) return state.timezone;
  }
  return DEFAULT_TIME_ZONE;
}

/** Feriados nacionais, da UF e do município de um intervalo, como `AAAA-MM-DD`. */
async function loadHolidays(
  tx: DbTransaction,
  place: LeadPlace,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const rows = await tx.holiday.findMany({
    where: {
      date: { gte: from, lt: to },
      isOptional: false,
      OR: [
        { scope: 'NATIONAL' },
        ...(place.stateUf ? [{ scope: 'STATE' as const, uf: place.stateUf }] : []),
        ...(place.municipalityCode
          ? [{ scope: 'MUNICIPAL' as const, municipalityCode: place.municipalityCode }]
          : []),
      ],
    },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

const DAY_MS = 86_400_000;

/**
 * Calendário útil do lead: fuso, feriados dos próximos meses e a janela (das
 * regras de contato ou a de uma cadência).
 */
export async function loadLeadCalendar(
  tx: DbTransaction,
  place: LeadPlace,
  now: Date,
  options: {
    rules: Pick<ContactRules, 'windowStart' | 'windowEnd' | 'workDays'>;
    window?: { start: string; end: string };
    useBusinessDays?: boolean;
  },
): Promise<BusinessCalendar> {
  const [timeZone, holidays] = await Promise.all([
    leadTimeZone(tx, place),
    loadHolidays(
      tx,
      place,
      new Date(now.getTime() - 7 * DAY_MS),
      new Date(now.getTime() + 400 * DAY_MS),
    ),
  ]);
  return {
    timeZone,
    windowStart: parseHhmm(options.window?.start ?? options.rules.windowStart),
    windowEnd: parseHhmm(options.window?.end ?? options.rules.windowEnd),
    workDays: options.rules.workDays,
    holidays,
    useBusinessDays: options.useBusinessDays ?? true,
  };
}
