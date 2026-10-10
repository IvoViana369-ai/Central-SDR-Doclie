/**
 * Feriados nacionais e pontos facultativos federais, calculados por ano.
 *
 * Base: Lei 662/1949 (com alterações), Lei 6.802/1980 (12/out), Lei 14.759/2023
 * (20/nov, a partir de 2024) e calendário de pontos facultativos federais.
 * Feriados estaduais e municipais são cadastrados à parte (fases posteriores).
 */
export interface HolidayDefinition {
  key: string;
  /** Data no formato AAAA-MM-DD (sem fuso). */
  date: string;
  name: string;
  /** Ponto facultativo (ex.: Carnaval): em geral sem expediente comercial. */
  isOptional: boolean;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDays(year: number, month: number, day: number, delta: number): string {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function nationalHolidays(year: number): HolidayDefinition[] {
  const easter = easterSunday(year);
  const fromEaster = (delta: number) => shiftDays(year, easter.month, easter.day, delta);

  const items: Omit<HolidayDefinition, 'key'>[] = [
    { date: isoDate(year, 1, 1), name: 'Confraternização Universal', isOptional: false },
    { date: fromEaster(-48), name: 'Carnaval (segunda-feira)', isOptional: true },
    { date: fromEaster(-47), name: 'Carnaval (terça-feira)', isOptional: true },
    { date: fromEaster(-2), name: 'Sexta-feira da Paixão', isOptional: false },
    { date: isoDate(year, 4, 21), name: 'Tiradentes', isOptional: false },
    { date: isoDate(year, 5, 1), name: 'Dia do Trabalho', isOptional: false },
    { date: fromEaster(60), name: 'Corpus Christi', isOptional: true },
    { date: isoDate(year, 9, 7), name: 'Independência do Brasil', isOptional: false },
    { date: isoDate(year, 10, 12), name: 'Nossa Senhora Aparecida', isOptional: false },
    { date: isoDate(year, 11, 2), name: 'Finados', isOptional: false },
    { date: isoDate(year, 11, 15), name: 'Proclamação da República', isOptional: false },
    ...(year >= 2024
      ? [
          {
            date: isoDate(year, 11, 20),
            name: 'Dia Nacional de Zumbi e da Consciência Negra',
            isOptional: false,
          },
        ]
      : []),
    { date: isoDate(year, 12, 25), name: 'Natal', isOptional: false },
  ];

  return items
    .map((item) => ({ ...item, key: `NATIONAL:${item.date}` }))
    .sort((x, y) => x.date.localeCompare(y.date));
}
