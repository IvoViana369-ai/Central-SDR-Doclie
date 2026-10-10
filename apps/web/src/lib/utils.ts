import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Fuso de exibição (docs/ARCHITECTURE.md §7.7: padrão `America/Fortaleza`).
 * Explícito para o servidor (UTC no contêiner) e o navegador mostrarem a
 * mesma hora.
 */
export const DISPLAY_TIME_ZONE = 'America/Fortaleza';

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateOnly.format(typeof value === 'string' ? new Date(value) : value);
}

/** "1 recusado", "2 recusados". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}
