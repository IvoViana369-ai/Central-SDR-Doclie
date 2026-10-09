import { z } from 'zod';
import {
  ASSISTED_CHANNELS,
  MESSAGE_TYPES,
  REPLY_CHANNELS,
  REPLY_CLASSIFICATIONS,
} from '../domain/labels';

const id = z.uuid({ message: 'Identificador inválido.' });
const body = z
  .string()
  .trim()
  .min(1, 'Escreva a mensagem.')
  .max(4000, 'Máximo de 4.000 caracteres.');
const instant = z.coerce.date({ message: 'Data e hora inválidas.' });

/** Contato assistido (F5-09): prepara o link com o texto; o humano envia no app. */
export const prepareMessageInput = z.object({
  leadId: id,
  channel: z.enum(ASSISTED_CHANNELS),
  /** Padrão: o primeiro contato utilizável do canal. */
  contactPointId: id.nullish(),
  body,
  messageType: z.enum(MESSAGE_TYPES).default('OTHER'),
  /** Tarefa que este envio cumpre (ex.: passo da cadência). */
  taskId: id.nullish(),
});

export const messageIdInput = z.object({ messageId: id });

export const confirmMessageInput = z.object({
  messageId: id,
  /** Quando foi enviada de fato (padrão: agora). */
  sentAt: instant.optional(),
});

/** Registro manual de um contato feito fora do fluxo (mensagem antiga, outro aparelho). */
export const logOutboundMessageInput = z.object({
  leadId: id,
  channel: z.enum(['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'SMS', 'OTHER']),
  body: body.nullish(),
  sentAt: instant,
  contactPointId: id.nullish(),
  messageType: z.enum(MESSAGE_TYPES).default('OTHER'),
  taskId: id.nullish(),
});

/** Resposta recebida, colada pelo SDR (F5-10), com classificação opcional. */
export const recordReplyInput = z.object({
  leadId: id,
  channel: z.enum(REPLY_CHANNELS),
  body,
  receivedAt: instant.optional(),
  contactPointId: id.nullish(),
  classification: z.enum(REPLY_CLASSIFICATIONS).nullish(),
  /** Para "Ausente": até quando (padrão: 7 dias). */
  outOfOfficeUntil: instant.nullish(),
});

export const classifyReplyInput = z.object({
  messageId: id,
  classification: z.enum(REPLY_CLASSIFICATIONS),
  outOfOfficeUntil: instant.nullish(),
});

export const leadMessagesInput = z.object({ leadId: id });
