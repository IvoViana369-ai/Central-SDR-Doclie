// Módulo instagram (docs/INTEGRATIONS.md §7.2; Fase 8): mensagens recebidas e
// respostas na janela de 24 h, comentários de leads com a resposta privada e
// métricas públicas dos perfis (Business Discovery) para o score.
export * from './domain';
export { FakeInstagramProvider, fakeInstagramUserId } from './infra/fake-provider';
export * from './contracts/schemas';
export {
  retryInstagramMessage,
  runInstagramSend,
  sendInstagramMessage,
  sendInstagramPrivateReply,
} from './application/send';
export { receiveInstagramWebhook, runInstagramWebhook } from './application/webhooks';
export {
  checkInstagramAccount,
  getInstagramSettings,
  linkInstagramUnmatched,
  retryInstagramUnmatched,
  runInstagramAccountCheck,
  runInstagramSuggestClassification,
  updateInstagramSettings,
} from './application/admin';
export {
  getInstagramOverview,
  getLeadInstagram,
  listInstagramConversations,
} from './application/reads';
