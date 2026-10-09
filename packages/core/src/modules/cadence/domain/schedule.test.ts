import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from '../../../shared/calendar';
import { firstStepDue, nextStepDue, plannedSchedule, validateCadenceSteps } from './schedule';

/** Fortaleza, 08h–18h, seg–sex; 12/10/2026 (segunda) é feriado. */
const calendar: BusinessCalendar = {
  timeZone: 'America/Fortaleza',
  windowStart: 480,
  windowEnd: 1080,
  workDays: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-10-12']),
  useBusinessDays: true,
};
const at = (iso: string) => new Date(iso);
/** Cadência padrão: D0, D2, D5, D10. */
const STEPS = [
  { position: 1, dayOffset: 0 },
  { position: 2, dayOffset: 2 },
  { position: 3, dayOffset: 5 },
  { position: 4, dayOffset: 10 },
];

describe('agenda da cadência (suíte de cadência, M11)', () => {
  it('D0/D2/D5/D10 em dias úteis, no início da janela, e "Sem resposta" 3 dias depois', () => {
    // Inscrito na sexta 09/10 às 10:00 (local).
    const plan = plannedSchedule(at('2026-10-09T13:00:00Z'), STEPS, 3, calendar);
    expect(plan.steps.map((s) => s.dueAt.toISOString())).toEqual([
      '2026-10-09T13:00:00.000Z', // D0: agora (na janela)
      '2026-10-14T11:00:00.000Z', // D2: pula sáb, dom e o feriado → qua 08:00
      '2026-10-19T11:00:00.000Z', // D5: +3 úteis → seg 19
      '2026-10-26T11:00:00.000Z', // D10: +5 úteis → seg 26
    ]);
    expect(plan.noResponseAt?.toISOString()).toBe('2026-10-29T11:00:00.000Z');
  });

  it('inscrição fora da janela: o primeiro passo vence na próxima abertura', () => {
    expect(firstStepDue(at('2026-10-13T22:30:00Z'), STEPS[0]!, calendar)).toEqual(
      at('2026-10-14T11:00:00Z'),
    );
  });

  it('atraso do SDR: o próximo passo conta da execução real (não acumula)', () => {
    // D0 previsto para 13/10, executado só em 16/10 (sexta) às 15:00.
    const due = nextStepDue(at('2026-10-16T18:00:00Z'), STEPS[0]!, STEPS[1]!, calendar);
    expect(due).toEqual(at('2026-10-20T11:00:00Z')); // +2 úteis → terça 20 às 08:00
  });

  it('em dias corridos, o passo cai no próximo dia de expediente', () => {
    const corridos = { ...calendar, useBusinessDays: false };
    // Quinta 08/10 + 2 corridos = sábado → segunda é feriado → terça 13.
    expect(nextStepDue(at('2026-10-08T13:00:00Z'), STEPS[0]!, STEPS[1]!, corridos)).toEqual(
      at('2026-10-13T11:00:00Z'),
    );
  });

  it('passos configurados: ao menos um, com dias crescentes', () => {
    expect(validateCadenceSteps(STEPS)).toEqual([]);
    expect(validateCadenceSteps([])).toHaveLength(1);
    expect(validateCadenceSteps([{ dayOffset: 0 }, { dayOffset: 0 }, { dayOffset: -1 }])).toEqual([
      'Passo 2: o dia deve ser depois do passo anterior.',
      'Passo 3: o dia não pode ser negativo.',
      'Passo 3: o dia deve ser depois do passo anterior.',
    ]);
  });
});
