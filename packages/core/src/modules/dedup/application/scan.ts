import type { DuplicateSource } from '@docline/db';
import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { systemActor } from '../../../shared/actor';
import { auditData, defineUseCase, type CoreDeps } from '../../../shared/use-case';
import { detectDuplicates, type DetectionSummary } from '../infra/detection';

/** Tempo máximo de cada transação da detecção (um lote de leads ou um bloco por UF). */
const DETECTION_TIMEOUT_MS = 120_000;

const emptySummary = (): DetectionSummary => ({
  pairs: 0,
  created: 0,
  updated: 0,
  reopened: 0,
  unchanged: 0,
  skipped: 0,
});

/**
 * Job `dedup.check-lead`: procura duplicados de leads cadastrados ou
 * alterados (cadastro manual, edição de identificadores, mesclagem).
 */
export async function runDuplicateCheck(
  deps: CoreDeps,
  job: { leadIds: string[]; source?: DuplicateSource },
): Promise<DetectionSummary> {
  const ids = [...new Set(job.leadIds)].slice(0, 1_000);
  if (ids.length === 0) return emptySummary();
  const { summary } = await deps.db.$transaction(
    (tx) => detectDuplicates(tx, { kind: 'leads', ids }, job.source ?? 'MANUAL', deps.clock.now()),
    { timeout: DETECTION_TIMEOUT_MS },
  );
  return summary;
}

/**
 * Job `dedup.scan` (diário e manual; F3-12): varredura completa em blocos por
 * UF, cada bloco na sua transação. Pares já decididos não voltam à fila.
 */
export async function runDuplicateScan(
  deps: CoreDeps,
): Promise<DetectionSummary & { blocks: number }> {
  const ufs = await deps.db.lead.findMany({
    where: { status: { in: ['ACTIVE', 'ARCHIVED'] } },
    distinct: ['stateUf'],
    select: { stateUf: true },
  });
  const total = emptySummary();
  for (const { stateUf } of ufs) {
    const { summary: block } = await deps.db.$transaction(
      (tx) => detectDuplicates(tx, { kind: 'block', stateUf }, 'SCAN', deps.clock.now()),
      { timeout: DETECTION_TIMEOUT_MS },
    );
    for (const key of Object.keys(total) as (keyof DetectionSummary)[]) total[key] += block[key];
  }
  const result = { ...total, blocks: ufs.length };
  await deps.db.auditLog.create({
    data: auditData(
      systemActor('dedup.scan'),
      {},
      {
        action: 'duplicate.scan_completed',
        entityType: 'duplicate_candidate',
        metadata: result,
      },
    ),
  });
  deps.logger.info(result, 'Varredura de duplicados concluída');
  return result;
}

/** Dispara a varredura completa fora do horário (ADMIN e GESTOR). */
export const requestDuplicateScan = defineUseCase({
  name: 'dedup.requestScan',
  access: 'duplicate.decide',
  input: z.object({}),
  async run(ctx) {
    const jobId = await ctx.deps.jobs.enqueue(
      JOBS.dedupScan.name,
      { requestedBy: ctx.actor.kind === 'user' ? ctx.actor.id : null },
      { tx: ctx.tx },
    );
    await ctx.audit({ action: 'duplicate.scan_requested', entityType: 'duplicate_candidate' });
    return { queued: true, jobId };
  },
});
