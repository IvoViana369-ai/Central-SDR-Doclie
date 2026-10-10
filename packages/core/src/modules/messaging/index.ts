// Módulo messaging (docs/ARCHITECTURE.md §6): contato assistido (link do app e
// confirmação do envio), registro manual de contatos, respostas recebidas com
// detecção de opt-out e classificação (Fase 5). Envio pela API: módulo whatsapp (Fase 7).
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
  recordOutboundSent,
} from './application/outbound';
export {
  applyInboundReply,
  classifyReply,
  recordReply,
  type InboundReply,
  type ReplyLead,
} from './application/replies';
export { listMessages } from './application/list';
