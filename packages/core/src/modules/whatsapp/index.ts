// Módulo whatsapp (docs/INTEGRATIONS.md §6.2; Fase 7): envio pela Cloud API
// (texto na janela de atendimento, modelos aprovados com opt-in), webhooks de
// status e de mensagens recebidas, modelos, conversas e saúde do número.
export * from './domain';
export { FAKE_TEMPLATES, FakeWhatsappProvider } from './infra/fake-provider';
export * from './contracts/schemas';
export { recordWhatsappOptIn, revokeWhatsappOptIn } from './application/opt-in';
export { retryWhatsappMessage, runWhatsappSend, sendWhatsappMessage } from './application/send';
export {
  checkWhatsappHealth,
  dismissUnmatchedInbound,
  getWhatsappSettings,
  linkUnmatchedInbound,
  listUnmatchedInbound,
  runWhatsappHealthCheck,
  runWhatsappSuggestClassification,
  runWhatsappTemplateSync,
  syncWhatsappTemplates,
  updateWhatsappSettings,
  updateWhatsappTemplate,
} from './application/admin';
export {
  receiveWhatsappWebhook,
  runWebhooksPurge,
  runWhatsappWebhook,
} from './application/webhooks';
