import { describe, expect, it } from 'vitest';
import { easterSunday, nationalHolidays } from './holidays';

describe('easterSunday', () => {
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2030, 4, 21],
    [2038, 4, 25],
  ])('%i → %i/%i', (year, month, day) => {
    expect(easterSunday(year)).toEqual({ month, day });
  });
});

describe('nationalHolidays', () => {
  const byName = (year: number) =>
    Object.fromEntries(nationalHolidays(year).map((h) => [h.name, h.date]));

  it('calcula as datas móveis de 2026', () => {
    const h = byName(2026);
    expect(h['Carnaval (segunda-feira)']).toBe('2026-02-16');
    expect(h['Carnaval (terça-feira)']).toBe('2026-02-17');
    expect(h['Sexta-feira da Paixão']).toBe('2026-04-03');
    expect(h['Corpus Christi']).toBe('2026-06-04');
  });

  it('calcula o Carnaval de 2027 (usado no cronograma do ROADMAP)', () => {
    const h = byName(2027);
    expect(h['Carnaval (segunda-feira)']).toBe('2027-02-08');
    expect(h['Carnaval (terça-feira)']).toBe('2027-02-09');
  });

  it('inclui o 20 de novembro somente a partir de 2024', () => {
    expect(byName(2023)['Dia Nacional de Zumbi e da Consciência Negra']).toBeUndefined();
    expect(byName(2024)['Dia Nacional de Zumbi e da Consciência Negra']).toBe('2024-11-20');
  });

  it('marca Carnaval e Corpus Christi como ponto facultativo', () => {
    const optional = nationalHolidays(2026)
      .filter((h) => h.isOptional)
      .map((h) => h.name);
    expect(optional).toEqual([
      'Carnaval (segunda-feira)',
      'Carnaval (terça-feira)',
      'Corpus Christi',
    ]);
  });

  it('gera chaves únicas e datas ordenadas', () => {
    const list = nationalHolidays(2026);
    expect(list).toHaveLength(13);
    expect(new Set(list.map((h) => h.key)).size).toBe(list.length);
    expect([...list].sort((a, b) => a.date.localeCompare(b.date))).toEqual(list);
  });
});
