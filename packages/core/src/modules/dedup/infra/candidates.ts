import type { DbTransaction, DuplicateSource } from '@docline/db';
import { toJson } from '../../../shared/use-case';
import { scoreSignals, type DuplicateSignal } from '../domain/scoring';

export type CandidateUpsert = 'created' | 'updated' | 'reopened' | 'unchanged' | 'skipped';

const signalKey = (s: DuplicateSignal) => `${s.rule}:${s.detail}`;

/** Sinais sem repetição (mesma regra e mesmo detalhe contam uma vez). */
export function uniqueSignals(signals: DuplicateSignal[]): DuplicateSignal[] {
  return [...new Map(signals.map((s) => [signalKey(s), s])).values()].sort((x, y) =>
    signalKey(x).localeCompare(signalKey(y)),
  );
}

/**
 * Registra um par de possíveis duplicados com os sinais atuais (a detecção
 * sempre calcula o conjunto completo do par, que substitui o anterior).
 *
 * - **Manter separados** e **mesclado**: o par nunca volta à fila (aceite M06).
 * - **Ignorado** ("por agora"): volta só se surgir evidência nova, isto é, uma
 *   regra que ainda não estava entre os motivos.
 *
 * Usa `INSERT … ON CONFLICT DO NOTHING`: uma corrida com outra detecção não
 * aborta a transação de quem chamou.
 */
export async function upsertCandidate(
  tx: DbTransaction,
  leadX: string,
  leadY: string,
  signals: DuplicateSignal[],
  detectedBy: DuplicateSource,
  now: Date,
): Promise<CandidateUpsert> {
  if (leadX === leadY || signals.length === 0) return 'skipped';
  const [leadAId, leadBId] = leadX < leadY ? [leadX, leadY] : [leadY, leadX];
  const fresh = uniqueSignals(signals);
  const { score, confidence } = scoreSignals(fresh);

  const created = await tx.duplicateCandidate.createMany({
    data: [
      {
        leadAId,
        leadBId,
        score,
        confidence,
        reasons: toJson(fresh),
        detectedBy,
        detectedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) return 'created';

  const existing = await tx.duplicateCandidate.findUniqueOrThrow({
    where: { leadAId_leadBId: { leadAId, leadBId } },
    select: { id: true, status: true, reasons: true },
  });
  if (existing.status === 'KEPT_SEPARATE' || existing.status === 'MERGED') return 'skipped';

  const previous = (existing.reasons as unknown as DuplicateSignal[] | null) ?? [];
  if (existing.status === 'IGNORED') {
    const known = new Set(previous.map((s) => s.rule));
    if (!fresh.some((s) => !known.has(s.rule))) return 'skipped';
    await tx.duplicateCandidate.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        score,
        confidence,
        reasons: toJson(fresh),
        detectedBy,
        detectedAt: now,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      },
    });
    return 'reopened';
  }

  const same =
    previous.length === fresh.length &&
    uniqueSignals(previous).every((s, i) => signalKey(s) === signalKey(fresh[i]!));
  if (same) return 'unchanged';
  await tx.duplicateCandidate.update({
    where: { id: existing.id },
    data: { score, confidence, reasons: toJson(fresh) },
  });
  return 'updated';
}
