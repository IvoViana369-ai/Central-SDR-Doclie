/**
 * Resultado de uma normalização: o valor padronizado ou o motivo da recusa.
 * Os motivos são códigos estáveis (usados na prévia de importação, na Fase 3);
 * `message` é o texto para a interface.
 */
export type Normalized<T> = { ok: true; value: T } | { ok: false; reason: string; message: string };

export function ok<T>(value: T): Normalized<T> {
  return { ok: true, value };
}

export function fail<T>(reason: string, message: string): Normalized<T> {
  return { ok: false, reason, message };
}
