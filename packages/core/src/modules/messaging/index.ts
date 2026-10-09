// Módulo messaging (docs/ARCHITECTURE.md §6): contato assistido (link do app e
// confirmação do envio), registro manual de contatos, respostas recebidas com
// detecção de opt-out e classificação (Fase 5). Envio pela API: Fase 7.
export * from './domain';
export * from './contracts/schemas';
export {
  cancelAssistedMessage,
  confirmAssistedMessage,
  describeMessage,
  listLeadMessages,
  logOutboundMessage,
  messageSelect,
  prepareAssistedMessage,
} from './application/outbound';
export { classifyReply, recordReply } from './application/replies';
