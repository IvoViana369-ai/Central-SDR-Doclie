import { describe, expect, it } from 'vitest';
import {
  addWorkDays,
  dueAfter,
  formatHhmm,
  isWithinWindow,
  localDayBounds,
  localParts,
  nextWindowOpening,
  parseHhmm,
  zonedTime,
  type BusinessCalendar,
} from './calendar';

/** Fortaleza (UTC−3, sem horário de verão), 08h–18h, seg–sex; 12/10/2026 é feriado (segunda). */
const calendar: BusinessCalendar = {
  timeZone: 'America/Fortaleza',
  windowStart: 8 * 60,
  windowEnd: 18 * 60,
  workDays: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-10-12']),
  useBusinessDays: true,
};
const at = (iso: string) => new Date(iso);

describe('calendário útil (suíte de cadência)', () => {
  it('horários HH:MM', () => {
    expect(parseHhmm('08:00')).toBe(480);
    expect(parseHhmm('17:45')).toBe(1065);
    expect(formatHhmm(1065)).toBe('17:45');
    expect(() => parseHhmm('24:00')).toThrow();
    expect(() => parseHhmm('8h')).toThrow();
  });

  it('hora local no fuso do lead', () => {
    expect(localParts(at('2026-10-13T12:00:00Z'), 'America/Fortaleza')).toMatchObject({
      year: 2026,
      month: 10,
      day: 13,
      weekday: 2,
      minutes: 9 * 60,
    });
    // Rio Branco (UTC−5): 07:00 local, ainda fora da janela.
    expect(localParts(at('2026-10-13T12:00:00Z'), 'America/Rio_Branco').minutes).toBe(7 * 60);
  });

  it('janela de contato: dia útil, entre o início e o fim, sem feriado', () => {
    expect(isWithinWindow(at('2026-10-13T12:00:00Z'), calendar)).toBe(true); // ter 09:00
    expect(isWithinWindow(at('2026-10-13T11:00:00Z'), calendar)).toBe(true); // ter 08:00
    expect(isWithinWindow(at('2026-10-13T21:00:00Z'), calendar)).toBe(false); // ter 18:00
    expect(isWithinWindow(at('2026-10-17T13:00:00Z'), calendar)).toBe(false); // sábado
    expect(isWithinWindow(at('2026-10-12T13:00:00Z'), calendar)).toBe(false); // feriado
    expect(
      isWithinWindow(at('2026-10-13T12:00:00Z'), { ...calendar, timeZone: 'America/Rio_Branco' }),
    ).toBe(false);
  });

  it('próxima abertura da janela: hoje mais tarde, amanhã ou depois do fim de semana e do feriado', () => {
    // Terça 06:00 → terça 08:00.
    expect(nextWindowOpening(at('2026-10-13T09:00:00Z'), calendar)).toEqual(
      at('2026-10-13T11:00:00Z'),
    );
    // Terça 19:00 → quarta 08:00.
    expect(nextWindowOpening(at('2026-10-13T22:00:00Z'), calendar)).toEqual(
      at('2026-10-14T11:00:00Z'),
    );
    // Sexta 20:00 → segunda é feriado → terça 08:00.
    expect(nextWindowOpening(at('2026-10-09T23:00:00Z'), calendar)).toEqual(
      at('2026-10-13T11:00:00Z'),
    );
    // Dentro da janela: o próprio instante.
    expect(nextWindowOpening(at('2026-10-13T15:30:00Z'), calendar)).toEqual(
      at('2026-10-13T15:30:00Z'),
    );
  });

  it('dias úteis pulam fim de semana e feriado; dias corridos caem no próximo dia útil', () => {
    const friday = { year: 2026, month: 10, day: 9 };
    expect(addWorkDays(friday, 1, calendar)).toEqual({ year: 2026, month: 10, day: 13 });
    expect(addWorkDays(friday, 3, calendar)).toEqual({ year: 2026, month: 10, day: 15 });
    const corridos = { ...calendar, useBusinessDays: false };
    // Sexta + 2 corridos = domingo → segunda é feriado → terça.
    expect(addWorkDays(friday, 2, corridos)).toEqual({ year: 2026, month: 10, day: 13 });
    expect(addWorkDays(friday, 6, corridos)).toEqual({ year: 2026, month: 10, day: 15 });
  });

  it('vencimento: início da janela do dia previsto; D0 vence agora ou na próxima abertura', () => {
    // Terça 15:00 + 2 dias úteis → quinta 08:00.
    expect(dueAfter(at('2026-10-13T18:00:00Z'), 2, calendar)).toEqual(at('2026-10-15T11:00:00Z'));
    // Sexta 16:00 + 2 dias úteis → (segunda feriado) terça, quarta → quarta 08:00.
    expect(dueAfter(at('2026-10-09T19:00:00Z'), 2, calendar)).toEqual(at('2026-10-14T11:00:00Z'));
    expect(dueAfter(at('2026-10-13T18:00:00Z'), 0, calendar)).toEqual(at('2026-10-13T18:00:00Z'));
    expect(dueAfter(at('2026-10-13T22:00:00Z'), 0, calendar)).toEqual(at('2026-10-14T11:00:00Z'));
  });

  it('limites do dia local e hora local em fuso com horário de verão', () => {
    expect(localDayBounds(at('2026-10-13T02:00:00Z'), 'America/Fortaleza')).toEqual({
      start: at('2026-10-12T03:00:00Z'),
      end: at('2026-10-13T03:00:00Z'),
    });
    // Nova York: 08:00 é 13:00Z antes do horário de verão e 12:00Z no dia em que ele começa.
    expect(zonedTime({ year: 2026, month: 3, day: 7 }, 480, 'America/New_York')).toEqual(
      at('2026-03-07T13:00:00Z'),
    );
    expect(zonedTime({ year: 2026, month: 3, day: 8 }, 480, 'America/New_York')).toEqual(
      at('2026-03-08T12:00:00Z'),
    );
  });
});
