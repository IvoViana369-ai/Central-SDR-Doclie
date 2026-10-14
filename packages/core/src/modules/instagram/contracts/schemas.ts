import { z } from 'zod';
import { MESSAGE_TYPES } from '../../messaging';

const id = z.uuid({ message: 'Identificador inválido.' });

/** Evita envio duplicado por clique repetido: o mesmo pedido devolve a mesma mensagem. */
const clientRequestId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'Identificador do pedido inválido.')
  .nullish();

/** A Meta aceita até 1.000 bytes em UTF-8 por mensagem do Instagram. */
export const INSTAGRAM_MAX_TEXT_BYTES = 1000;

const text = z
  .string()
  .trim()
  .min(1, 'Escreva a mensagem.')
  .refine((v) => new TextEncoder().encode(v).length <= INSTAGRAM_MAX_TEXT_BYTES, {
    message: 'Mensagem longa demais para o Instagram (até 1.000 bytes, cerca de 1.000 letras).',
  });

/**
 * Resposta pela API (F8-03): só para quem escreveu nas últimas 24 h. O texto
 * pode ser o rascunho aprovado da IA.
 */
export const sendInstagramMessageInput = z
  .object({
    leadId: id,
    /** Tarefa que este envio cumpre (ex.: passo da cadência). */
    taskId: id.nullish(),
    messageType: z.enum(MESSAGE_TYPES).default('OTHER'),
    body: text.nullish(),
    aiGenerationId: id.nullish(),
    clientRequestId,
  })
  .refine((v) => Boolean(v.body) || Boolean(v.aiGenerationId), {
    message: 'Escreva a mensagem.',
    path: ['body'],
  });

/** Resposta privada a um comentário do lead (uma por comentário, até 7 dias). */
export const sendInstagramPrivateReplyInput = z.object({
  commentId: id,
  body: text,
  clientRequestId,
});

export const retryInstagramMessageInput = z.object({
  messageId: id,
  /** Para envio de resultado incerto: a pessoa assume o risco de mensagem repetida. */
  confirmDuplicateRisk: z.boolean().default(false),
});

export const leadInstagramInput = z.object({ leadId: id });

export const instagramUnmatchedInput = z.object({ unmatchedId: id });

export const linkInstagramUnmatchedInput = z.object({ unmatchedId: id, leadId: id });
