import {
  JOBS,
  runAnalyticsRollup,
  runAutoAssign,
  runCadenceTick,
  runInsightsJob,
  runCampaignBuild,
  runCampaignTick,
  runDuplicateCheck,
  runForgottenScan,
  runOverdueScan,
  runRegistryCheck,
  runProspectingPurge,
  runRegistryIngestion,
  runDuplicateScan,
  runImportCommit,
  runImportParse,
  runImportPreview,
  runImportPurge,
  runInstagramAccountCheck,
  runInstagramDiscovery,
  runInstagramSend,
  runInstagramSuggestClassification,
  runInstagramWebhook,
  runScoreRecomputeAll,
  runScoreRecomputeLeads,
  runWebhooksPurge,
  runWhatsappHealthCheck,
  runWhatsappSend,
  runWhatsappSuggestClassification,
  runWhatsappTemplateSync,
  runWhatsappWebhook,
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
    [JOBS.cadenceTick.name]: async () => runCadenceTick(deps),
    [JOBS.tasksOverdueScan.name]: async () => runOverdueScan(deps),
    [JOBS.leadsForgottenScan.name]: async () => runForgottenScan(deps),
    [JOBS.scoreRecomputeAll.name]: async (data) =>
      runScoreRecomputeAll(deps, scoreAllJob.parse(data ?? {})),
    [JOBS.whatsappSend.name]: async (data) => runWhatsappSend(deps, data),
    [JOBS.whatsappWebhook.name]: async (data) => runWhatsappWebhook(deps, data),
    [JOBS.whatsappSuggestClassification.name]: async (data) =>
      runWhatsappSuggestClassification(deps, data),
    [JOBS.whatsappSyncTemplates.name]: async () => runWhatsappTemplateSync(deps),
    [JOBS.whatsappHealthCheck.name]: async () => runWhatsappHealthCheck(deps),
    [JOBS.webhooksPurge.name]: async () => runWebhooksPurge(deps),
    [JOBS.instagramSend.name]: async (data) => runInstagramSend(deps, data),
    [JOBS.instagramWebhook.name]: async (data) => runInstagramWebhook(deps, data),
    [JOBS.instagramSuggestClassification.name]: async (data) =>
      runInstagramSuggestClassification(deps, data),
    [JOBS.instagramAccountCheck.name]: async () => runInstagramAccountCheck(deps),
    [JOBS.instagramDiscovery.name]: async () => runInstagramDiscovery(deps),
    [JOBS.registryCheck.name]: async () => runRegistryCheck(deps),
    [JOBS.registryIngest.name]: async (data) => runRegistryIngestion(deps, data),
    [JOBS.prospectingPurge.name]: async () => runProspectingPurge(deps),
    [JOBS.campaignBuild.name]: async (data) => runCampaignBuild(deps, data),
    [JOBS.campaignTick.name]: async (data) => runCampaignTick(deps, data ?? {}),
    [JOBS.analyticsRollup.name]: async (data) => runAnalyticsRollup(deps, data ?? {}),
    [JOBS.analyticsInsights.name]: async () => runInsightsJob(deps),
    [JOBS.leadsAutoAssign.name]: async () => runAutoAssign(deps),
  };
}
