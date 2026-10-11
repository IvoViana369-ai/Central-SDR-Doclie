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
