/** Números dos indicadores em pt-BR. */

const integer = new Intl.NumberFormat('pt-BR');

export const fmtInt = (value: number) => integer.format(value);

export function fmtPct(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** Horas até 48 h; acima disso, em dias. */
export function fmtHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${(hours / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

/** "1 parceiro", "2 parceiros". */
export const plural = (count: number, one: string, many: string) =>
  `${fmtInt(count)} ${count === 1 ? one : many}`;

/** "13/10" a partir de "2026-10-13". */
export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "01/10/2026" a partir de "2026-10-01". */
export const fmtDate = (iso: string) => `${fmtDay(iso)}/${iso.slice(0, 4)}`;
