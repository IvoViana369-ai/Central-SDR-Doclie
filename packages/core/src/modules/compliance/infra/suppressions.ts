import type { DbTransaction, SuppressionType } from '@docline/db';
import type { MatchedSuppression } from '../domain/contact-status';

export interface SuppressionIdentifier {
  type: SuppressionType;
  /** HMAC do valor normalizado; para o tipo LEAD, o id do lead. */
  valueHash: string;
}

export interface ActiveSuppression extends MatchedSuppression {
  id: string;
  type: SuppressionType;
  valueHash: string;
  createdAt: Date;
}

export const identifierKey = (identifier: SuppressionIdentifier) =>
  `${identifier.type}:${identifier.valueHash}`;

/** Supressões vigentes (não revogadas) dos identificadores informados, agrupadas por identificador. */
export async function findActiveSuppressions(
  tx: DbTransaction,
  identifiers: SuppressionIdentifier[],
): Promise<Map<string, ActiveSuppression[]>> {
  const result = new Map<string, ActiveSuppression[]>();
  if (identifiers.length === 0) return result;
  // Um `IN` por tipo: a exportação consulta milhares de identificadores de uma vez.
  const byType = new Map<SuppressionType, string[]>();
  for (const i of identifiers) {
    const hashes = byType.get(i.type);
    if (hashes) hashes.push(i.valueHash);
    else byType.set(i.type, [i.valueHash]);
  }
  const rows = await tx.suppressionEntry.findMany({
    where: {
      revokedAt: null,
      OR: [...byType].map(([type, hashes]) => ({ type, valueHash: { in: hashes } })),
    },
    select: { id: true, type: true, valueHash: true, reason: true, scope: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) {
    const key = identifierKey(row);
    result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}
