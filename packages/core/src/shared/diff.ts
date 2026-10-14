import type { AuditChanges } from './use-case';

/**
 * Diferença campo a campo para a auditoria ({ campo: [antes, depois] }).
 * Campos sensíveis devem ser omitidos ou mascarados por quem chama.
 */
export function diffFields<T extends object>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const previous = before[field];
    const next = after[field];
    const same =
      previous instanceof Date && next instanceof Date
        ? previous.getTime() === next.getTime()
        : Object.is(previous, next);
    if (!same) changes[String(field)] = [previous, next];
  }
  return changes;
}
