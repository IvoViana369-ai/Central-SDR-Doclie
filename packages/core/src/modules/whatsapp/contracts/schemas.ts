import { z } from 'zod';
import { OPT_IN_METHODS } from '../../compliance';
import { MESSAGE_TYPES } from '../../messaging';

const id = z.uuid({ message: 'Identificador inválido.' });

/**
 * Opt-in do WhatsApp de um número (F7-05). "O contato escreveu concordando"
 * aponta a mensagem recebida; os demais métodos exigem a descrição da evidência.
 */
export const recordWhatsappOptInInput = z.object({
  leadId: id,
  contactPointId: id,
  method: z.enum(OPT_IN_METHODS),
  evidence: z.string().trim().max(1000, 'Máximo de 1.000 caracteres.').nullish(),
  evidenceMessageId: id.nullish(),
});

export const revokeWhatsappOptInInput = z.object({
  leadId: id,
  contactPointId: id,
  reason: z.string().trim().max(500, 'Máximo de 500 caracteres.').nullish(),
});

/** Evita envio duplicado por clique repetido: o mesmo pedido devolve a mesma mensagem. */
const clientRequestId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'Identificador do pedido inválido.')
  .nullish();

const common = {
  leadId: id,
  /** Padrão: o primeiro número que serve para este envio. */
  contactPointId: id.nullish(),
  /** Tarefa que este envio cumpre (ex.: passo da cadência). */
  taskId: id.nullish(),
  messageType: z.enum(MESSAGE_TYPES).default('OTHER'),
  clientRequestId,
};

/**
 * Envio pela API (F7-01): texto livre só na janela de atendimento (ou o
 * rascunho aprovado da IA); fora dela, modelo aprovado para número com opt-in.
 */
export const sendWhatsappMessageInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      ...common,
      body: z
        .string()
        .trim()
        .min(1, 'Escreva a mensagem.')
        .max(4096, 'Máximo de 4.096 caracteres.')
        .nullish(),
      aiGenerationId: id.nullish(),
    })
    .refine((v) => Boolean(v.body) || Boolean(v.aiGenerationId), {
      message: 'Escreva a mensagem.',
      path: ['body'],
    }),
  z.object({
    kind: z.literal('template'),
    ...common,
    templateId: id,
    /** Valor de cada variável do corpo ("1", "2"… ou o nome). */
    params: z.record(z.string(), z.string().max(1024)).default({}),
  }),
]);

export const retryWhatsappMessageInput = z.object({
  messageId: id,
  /** Para envio de resultado incerto: a pessoa assume o risco de mensagem repetida. */
  confirmDuplicateRisk: z.boolean().default(false),
});

export const leadWhatsappInput = z.object({ leadId: id });
