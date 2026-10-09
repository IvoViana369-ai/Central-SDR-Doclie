import type { DbTransaction, DuplicateSource } from '@docline/db';
import { toJson } from '../../../shared/use-case';
import { scoreSignals, type DuplicateSignal } from '../domain/scoring';

/**
 * Registra (ou reforça) um par de possíveis duplicados. Par já decidido
 * (mesclado, mantido separado ou ignorado) não volta para a fila (M06).
 */
export async function upsertCandidate(
  tx: DbTransaction,
  leadX: string,
  leadY: string,
  signals: DuplicateSignal[],
  detectedBy: DuplicateSource,
): Promise<'created' | 'updated' | 'skipped'> {
  if (leadX === leadY || signals.length === 0) return 'skipped';
  const [leadAId, leadBId] = leadX < leadY ? [leadX, leadY] : [leadY, leadX];
  const existing = await tx.duplicateCandidate.findUnique({
    where: { leadAId_leadBId: { leadAId, leadBId } },
    select: { id: true, status: true, reasons: true },
  });
  if (existing && existing.status !== 'PENDING') return 'skipped';
  const merged = [
    ...((existing?.reasons as unknown as DuplicateSignal[] | null) ?? []),
    ...signals,
  ];
  const unique = [...new Map(merged.map((s) => [`${s.rule}:${s.detail}`, s])).values()];
  const { score, confidence } = scoreSignals(unique);
  if (existing) {
    await tx.duplicateCandidate.update({
      where: { id: existing.id },
      data: { score, confidence, reasons: toJson(unique) },
    });
    return 'updated';
  }
  await tx.duplicateCandidate.create({
    data: { leadAId, leadBId, score, confidence, reasons: toJson(unique), detectedBy },
  });
  return 'created';
}
