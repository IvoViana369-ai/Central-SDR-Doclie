import {
  JOBS,
  runDuplicateCheck,
  runDuplicateScan,
  runImportCommit,
  runImportParse,
  runImportPreview,
  runImportPurge,
  runScoreRecomputeAll,
  runScoreRecomputeLeads,
  type CoreDeps,
} from '@docline/core';
import { spreadsheetReader } from '@docline/integrations';
import { z } from 'zod';
import { recordHeartbeat } from './heartbeat';

/** Dados de um job, conferidos antes de rodar (a fila é compartilhada com o web). */
const batchJob = z.object({ batchId: z.uuid() });
const checkJob = z.object({
  leadIds: z.array(z.uuid()).min(1).max(1_000),
  source: z.enum(['IMPORT', 'SCAN', 'MANUAL', 'PROSPECTING']).optional(),
});
const scoreLeadsJob = z.object({
  leadIds: z.array(z.uuid()).min(1).max(1_000),
  trigger: z.string().max(60).optional(),
});
const scoreAllJob = z.object({
  trigger: z.string().max(60).optional(),
  municipalityCode: z.number().int().positive().nullish(),
});

export type JobHandler = (data: unknown) => Promise<unknown>;

/** Handler de cada job do catálogo (docs/ARCHITECTURE.md §10). */
export function jobHandlers(deps: CoreDeps, startedAt: Date): Record<string, JobHandler> {
  // Sempre assíncronos: dado inválido vira promessa rejeitada (o pg-boss registra a falha).
  return {
    [JOBS.heartbeat.name]: async () => recordHeartbeat(deps.db, startedAt),
    [JOBS.importParse.name]: async (data) =>
      runImportParse(deps, spreadsheetReader, batchJob.parse(data)),
    [JOBS.importPreview.name]: async (data) => runImportPreview(deps, batchJob.parse(data)),
    [JOBS.importCommit.name]: async (data) => runImportCommit(deps, batchJob.parse(data)),
    [JOBS.importPurge.name]: async () => runImportPurge(deps),
    [JOBS.dedupCheckLead.name]: async (data) => runDuplicateCheck(deps, checkJob.parse(data)),
    [JOBS.dedupScan.name]: async () => runDuplicateScan(deps),
    [JOBS.scoreRecomputeLeads.name]: async (data) =>
      runScoreRecomputeLeads(deps, scoreLeadsJob.parse(data)),
    [JOBS.scoreRecomputeAll.name]: async (data) =>
      runScoreRecomputeAll(deps, scoreAllJob.parse(data ?? {})),
  };
}
