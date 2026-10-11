// Módulo integrations (docs/ARCHITECTURE.md §6; Fase 12): chaves de API com
// escopos, webhooks de saída assinados, referências externas e a Lista Não
// Contatar compartilhada com outros sistemas Docline.
export * from './domain';
export {
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  deriveWebhookSecret,
  generateApiKey,
  hashApiKey,
  signWebhook,
  verifyWebhookSignature,
  type GeneratedApiKey,
} from './domain/signing';
export * from './contracts/schemas';
export {
  assertApiKeyScope,
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyActor,
  type ApiKeyStatus,
  type ApiKeyView,
} from './application/api-keys';
export { FakeWebhookSender } from './infra/fake-sender';
export {
  createWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  resendWebhookDelivery,
  rotateWebhookSecret,
  sendTestWebhook,
  setWebhookEndpointStatus,
  updateWebhookEndpoint,
  type WebhookEndpointView,
} from './application/webhooks';
export {
  OUTBOUND_EVENT_RETENTION_DAYS,
  purgeOutboundEvents,
  runWebhookDispatch,
  type DispatchResult,
} from './application/dispatch';
export {
  findExternalReferences,
  removeExternalReference,
  upsertExternalReference,
} from './application/references';
export { checkSuppressions, registerExternalOptOut } from './application/shared-list';
export { getIntegrationLead } from './application/crm';
export { getTaskCalendar } from './application/calendar';
export { exportBiDailyMetrics, exportBiEvents } from './application/bi';
