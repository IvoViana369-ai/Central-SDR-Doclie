/** Rótulos das mensagens e respostas (docs/SDR-FLOW.md §6 e §7). */

export const REPLY_CLASSIFICATIONS = [
  'INTERESTED',
  'QUESTION',
  'OBJECTION',
  'NOT_INTERESTED',
  'OPT_OUT',
  'OUT_OF_OFFICE',
  'WRONG_CONTACT',
  'OTHER',
] as const;
export type ReplyClassificationKey = (typeof REPLY_CLASSIFICATIONS)[number];

export const REPLY_CLASSIFICATION_LABELS: Record<ReplyClassificationKey, string> = {
  INTERESTED: 'Interessado',
  QUESTION: 'Dúvida',
  OBJECTION: 'Objeção',
  NOT_INTERESTED: 'Sem interesse',
  OPT_OUT: 'Pediu para não ser contatado',
  OUT_OF_OFFICE: 'Ausente (fora do escritório)',
  WRONG_CONTACT: 'Contato errado',
  OTHER: 'Outro',
};

export const MESSAGE_TYPES = [
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'INTERESTED_REPLY',
  'OBJECTION_REPLY',
  'SCHEDULING',
  'REACTIVATION',
  'OTHER',
] as const;
export type MessageTypeKey = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_TYPE_LABELS: Record<MessageTypeKey, string> = {
  FIRST_CONTACT: 'Primeiro contato',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  FOLLOW_UP_3: 'Follow-up 3',
  INTERESTED_REPLY: 'Resposta a interessado',
  OBJECTION_REPLY: 'Resposta a objeção',
  SCHEDULING: 'Agendamento',
  REACTIVATION: 'Reativação',
  OTHER: 'Outra',
};

export const MESSAGE_STATUS_LABELS = {
  PENDING_CONFIRMATION: 'Aguardando confirmação do envio',
  QUEUED: 'Na fila',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Falhou',
  RECEIVED: 'Recebida',
  CANCELED: 'Cancelada',
} as const;

/** Canais do contato assistido por mensagem (ligação é atividade, não mensagem). */
export const ASSISTED_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'EMAIL'] as const;
export type AssistedChannel = (typeof ASSISTED_CHANNELS)[number];

/** Canais em que uma resposta pode chegar (colada pelo SDR). */
export const REPLY_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE', 'SMS', 'OTHER'] as const;

/** Canais de contato e de cadência, para telas e auditoria. */
export const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  SMS: 'SMS',
  OTHER: 'Outro',
  ANY: 'Qualquer canal',
};
