import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from '../../../shared/calendar';
import { evaluateContactTiming, type ContactTimingInput } from './contact-timing';

const calendar: BusinessCalendar = {
  timeZone: 'America/Fortaleza',
  windowStart: 480,
  windowEnd: 1080,
  workDays: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-10-12']),
  useBusinessDays: true,
};
const at = (iso: string) => new Date(iso);
const base: ContactTimingInput = {
  now: at('2026-10-13T12:00:00Z'), // terça 09:00 em Fortaleza
  calendar,
  lastContactAt: null,
  lastInboundAt: null,
  minHoursBetweenContacts: 48,
  firstContact: true,
  firstContactsToday: 0,
  maxFirstContactsPerDay: 40,
};

describe('limites de horário e frequência do gate (F5-08)', () => {
  it('na janela, sem contato recente e abaixo do limite: liberado', () => {
    expect(evaluateContactTiming(base)).toEqual({ allowed: true, reasons: [], availableAt: null });
  });

  it('fora da janela: bloqueado até a próxima abertura, com o horário no texto', () => {
    const result = evaluateContactTiming({ ...base, now: at('2026-10-13T22:00:00Z') });
    expect(result.allowed).toBe(false);
    expect(result.availableAt).toEqual(at('2026-10-14T11:00:00Z'));
    expect(result.reasons[0]).toBe(
      'Fora da janela de contato (08:00–18:00 no horário do lead). Próxima abertura: qua 14/10 às 08:00.',
    );
  });

  it('intervalo mínimo entre contatos, exceto para responder a quem escreveu', () => {
    const recent = { ...base, firstContact: false, lastContactAt: at('2026-10-12T19:00:00Z') };
    const blocked = evaluateContactTiming(recent);
    expect(blocked.allowed).toBe(false);
    // 48 h depois = qua 14/10 16:00 local, dentro da janela.
    expect(blocked.availableAt).toEqual(at('2026-10-14T19:00:00Z'));
    expect(
      evaluateContactTiming({ ...recent, lastInboundAt: at('2026-10-13T11:30:00Z') }).allowed,
    ).toBe(true);
    // Resposta antiga (antes do último contato) não libera.
    expect(
      evaluateContactTiming({ ...recent, lastInboundAt: at('2026-10-10T11:30:00Z') }).allowed,
    ).toBe(false);
  });

  it('limite diário de primeiros contatos por SDR (follow-ups não contam)', () => {
    const full = { ...base, firstContactsToday: 40 };
    const result = evaluateContactTiming(full);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual([
      'Limite de 40 primeiros contatos por dia atingido. Retome amanhã.',
    ]);
    expect(result.availableAt).toEqual(at('2026-10-14T11:00:00Z'));
    expect(evaluateContactTiming({ ...full, firstContact: false }).allowed).toBe(true);
  });
});
