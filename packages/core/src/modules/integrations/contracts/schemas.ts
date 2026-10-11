import { z } from 'zod';
import { API_SCOPE_KEYS } from '../../identity';
import { WEBHOOK_URL_MAX_LENGTH } from '../domain/network';
import {
  EXTERNAL_ENTITY_TYPES,
  EXTERNAL_ID_MAX_LENGTH,
  SYSTEM_CODE_PATTERN,
} from '../domain/references';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '../domain/webhooks';

const id = z.uuid('Identificador inválido.');

export const systemCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SYSTEM_CODE_PATTERN, 'Use letras maiúsculas, números e _ (ex.: DOCLINE_CRM).');

const uniqueList = <T extends z.ZodType<string>>(item: T, label: string) =>
  z
    .array(item)
    .min(1, `Escolha pelo menos um ${label}.`)
    .refine((list) => new Set(list).size === list.length, `Há ${label}s repetidos.`);

// -----------------------------------------------------------------------------
// Chaves de API (F12-01)
// -----------------------------------------------------------------------------

export const API_KEY_MAX_RATE = 6000;

export const createApiKeyInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome à chave (ex.: CRM Docline).').max(80),
  scopes: uniqueList(z.enum(API_SCOPE_KEYS), 'escopo'),
  system: systemCode.nullish(),
  rateLimitPerMinute: z
    .number()
    .int()
    .min(1, 'O limite é de pelo menos 1 requisição por minuto.')
    .max(API_KEY_MAX_RATE, `O limite é de até ${API_KEY_MAX_RATE} requisições por minuto.`)
    .optional(),
  /** Validade opcional (fim do dia informado, no fuso da equipe, fica a cargo da tela). */
  expiresAt: z.coerce.date().nullish(),
});

export const revokeApiKeyInput = z.object({
  apiKeyId: id,
  reason: z.string().trim().min(3, 'Informe o motivo da revogação.').max(300),
});

export const listApiKeysInput = z.object({
  status: z.enum(['ACTIVE', 'ALL']).default('ALL'),
});

// -----------------------------------------------------------------------------
// Webhooks de saída (F12-02)
// -----------------------------------------------------------------------------

const webhookEvents = uniqueList(z.enum(WEBHOOK_EVENT_TYPES), 'evento');

export const createWebhookEndpointInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome ao destino (ex.: CRM Docline).').max(80),
  url: z.string().trim().min(1, 'Informe a URL.').max(WEBHOOK_URL_MAX_LENGTH),
  events: webhookEvents,
  system: systemCode.nullish(),
});

export const updateWebhookEndpointInput = z.object({
  endpointId: id,
  name: z.string().trim().min(2).max(80).optional(),
  url: z.string().trim().min(1).max(WEBHOOK_URL_MAX_LENGTH).optional(),
  events: webhookEvents.optional(),
  system: systemCode.nullish(),
});

export const webhookEndpointIdInput = z.object({ endpointId: id });

export const setWebhookEndpointStatusInput = z.object({
  endpointId: id,
  status: z.enum(['ACTIVE', 'PAUSED']),
});

export const listWebhookDeliveriesInput = z.object({
  endpointId: id.optional(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
  /** Id da última entrega da página anterior (mais recentes primeiro). */
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const webhookDeliveryIdInput = z.object({ deliveryId: id });

// -----------------------------------------------------------------------------
// Referências externas (F12-03) e Lista Não Contatar compartilhada (F12-04)
// -----------------------------------------------------------------------------

const entityType = z.enum(EXTERNAL_ENTITY_TYPES);
const externalId = z
  .string()
  .trim()
  .min(1, 'Informe o id no outro sistema.')
  .max(EXTERNAL_ID_MAX_LENGTH, `O id externo tem até ${EXTERNAL_ID_MAX_LENGTH} caracteres.`);

export const upsertExternalReferenceInput = z.object({
  entityType,
  entityId: id,
  /** Obrigatório para pessoas; a chave de API com sistema usa o dela. */
  system: systemCode.optional(),
  externalId,
  /** Link para o registro no outro sistema (http/https). */
  url: z
    .url({ protocol: /^https?$/, message: 'Use um link http(s).' })
    .max(WEBHOOK_URL_MAX_LENGTH)
    .nullish(),
});

export const removeExternalReferenceInput = z.object({
  entityType,
  entityId: id,
  system: systemCode.optional(),
});

/** Busca pelo id externo ou lista os vínculos de um registro. */
export const findExternalReferencesInput = z
  .object({
    entityType,
    entityId: id.optional(),
    system: systemCode.optional(),
    externalId: externalId.optional(),
  })
  .refine((v) => v.entityId || v.externalId, {
    message: 'Informe entityId ou externalId.',
    path: ['externalId'],
  });

export const integrationLeadInput = z.object({ leadId: id });

const identifierInput = z.object({
  type: z.enum(['PHONE', 'EMAIL', 'INSTAGRAM', 'CNPJ']),
  value: z.string().trim().min(1, 'Informe o valor.').max(200),
});

export const SUPPRESSION_BATCH_MAX = 100;

export const checkSuppressionsInput = z.object({
  identifiers: z
    .array(identifierInput)
    .min(1, 'Informe ao menos um identificador.')
    .max(SUPPRESSION_BATCH_MAX, `No máximo ${SUPPRESSION_BATCH_MAX} identificadores por vez.`),
  /** Canal que o outro sistema pretende usar (ALL_CHANNELS = qualquer). */
  channel: z
    .enum(['ALL_CHANNELS', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE'])
    .default('ALL_CHANNELS'),
});

export const registerExternalOptOutInput = z.object({
  identifiers: checkSuppressionsInput.shape.identifiers,
  scope: z
    .enum(['ALL_CHANNELS', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE'])
    .default('ALL_CHANNELS'),
  reason: z.enum(['OPT_OUT', 'DATA_SUBJECT_REQUEST', 'COMPLAINT']).default('OPT_OUT'),
  /** Onde o pedido foi recebido (sem dados pessoais além do necessário). */
  notes: z.string().trim().max(300).nullish(),
});

// -----------------------------------------------------------------------------
// Agenda (F12-05) e exportação para BI (F12-06)
// -----------------------------------------------------------------------------

export const taskCalendarInput = z.object({ taskId: id });

const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(z.enum(values)).min(1),
  );

export const biEventsInput = z.object({
  /** Id do último evento lido (os ids crescem com o tempo). */
  after: id.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  types: csvList(WEBHOOK_EVENT_TYPES as [WebhookEventType, ...WebhookEventType[]]).optional(),
});

export const biDailyMetricsInput = z.object({
  /** Cursor devolvido pelo pedido anterior. */
  cursor: z.string().max(200).optional(),
  /** Dias por página. */
  limit: z.coerce.number().int().min(1).max(366).default(31),
  dimension: z.enum(['GLOBAL', 'SDR', 'CHANNEL']).optional(),
});
