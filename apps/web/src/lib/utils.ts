import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return timeZone
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(
        date,
      )
    : dateTime.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateOnly.format(typeof value === 'string' ? new Date(value) : value);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}
