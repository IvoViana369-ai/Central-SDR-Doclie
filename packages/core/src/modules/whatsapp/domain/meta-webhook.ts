import { z } from 'zod';

/**
 * Leitura do webhook do WhatsApp (formato da Meta, docs/INTEGRATIONS.md §6.2):
 * converte o corpo recebido em eventos do domínio. Tolerante: campos novos são
 * ignorados e um item fora do formato vira `ignored` sem derrubar os demais
 * (a Meta acrescenta campos e tipos com frequência).
 *
 * Campos lidos: `messages` (mensagens recebidas e status das enviadas),
 * `message_template_status_update`, `message_template_quality_update`,
 * `phone_number_quality_update` e `account_update`.
 */

export type WhatsappDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsappInboundMessageEvent {
  type: 'message';
  phoneNumberId: string | null;
  providerMessageId: string;
  /** `wa_id` de quem escreveu. */
  from: string;
  profileName: string | null;
  timestamp: Date;
  /** Tipo na Meta: text, button, interactive, image, audio, document… */
  messageKind: string;
  /** Texto (ou legenda, ou título do botão), quando há. */
  text: string | null;
}

export interface WhatsappStatusEvent {
  type: 'status';
  providerMessageId: string;
  status: WhatsappDeliveryStatus;
  timestamp: Date;
  recipientId: string | null;
  /** `biz_opaque_callback_data`: nosso id da mensagem. */
  reference: string | null;
  pricing: { billable: boolean | null; category: string | null; type: string | null } | null;
  error: { code: string; title: string | null; detail: string | null } | null;
}

export interface WhatsappTemplateStatusEvent {
  type: 'template_status';
  metaTemplateId: string;
  status: string;
  reason: string | null;
}

export interface WhatsappTemplateQualityEvent {
  type: 'template_quality';
  metaTemplateId: string;
  qualityScore: string;
}

/** Mudança no número (qualidade, limite, bloqueio) ou na conta: dispara a checagem de saúde. */
export interface WhatsappAccountEvent {
  type: 'account';
  field: string;
  event: string | null;
}

export interface WhatsappIgnoredEvent {
  type: 'ignored';
  field: string;
  reason: string;
}

export type WhatsappWebhookEvent =
  | WhatsappInboundMessageEvent
  | WhatsappStatusEvent
  | WhatsappTemplateStatusEvent
  | WhatsappTemplateQualityEvent
  | WhatsappAccountEvent
  | WhatsappIgnoredEvent;

const idLike = z.union([z.string().min(1), z.number()]).transform(String);
/** Timestamps da Meta são segundos Unix em texto. */
const unixSeconds = z
  .union([z.string().regex(/^\d+$/), z.number().int()])
  .transform((v) => new Date(Number(v) * 1000));

const envelope = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: idLike.optional(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
    }),
  ),
});

const messagesValue = z.object({
  metadata: z.object({ phone_number_id: idLike.optional() }).optional(),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().optional(),
        profile: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const inboundMessage = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: unixSeconds,
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string().optional(), payload: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string() }).optional(),
      list_reply: z.object({ title: z.string() }).optional(),
    })
    .optional(),
  image: z.object({ caption: z.string().optional() }).optional(),
  video: z.object({ caption: z.string().optional() }).optional(),
  document: z.object({ caption: z.string().optional() }).optional(),
});

const statusItem = z.object({
  id: z.string().min(1),
  status: z.string(),
  timestamp: unixSeconds,
  recipient_id: z.string().optional(),
  biz_opaque_callback_data: z.string().optional(),
  pricing: z
    .object({
      billable: z.boolean().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        code: idLike,
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const templateStatusValue = z.object({
  event: z.string(),
  message_template_id: idLike,
  reason: z.string().nullish(),
});

const templateQualityValue = z.object({
  message_template_id: idLike,
  new_quality_score: z.string(),
});

const STATUS: Record<string, WhatsappDeliveryStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Tipos que não são resposta do contato (reação a uma mensagem, aviso do sistema). */
const NOT_A_REPLY = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'request_welcome']);

function inboundText(message: z.infer<typeof inboundMessage>): string | null {
  switch (message.type) {
    case 'text':
      return message.text?.body ?? null;
    case 'button':
      return message.button?.text ?? message.button?.payload ?? null;
    case 'interactive':
      return (
        message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null
      );
    case 'image':
      return message.image?.caption ?? null;
    case 'video':
      return message.video?.caption ?? null;
    case 'document':
      return message.document?.caption ?? null;
    default:
      return null;
  }
}

function parseMessagesChange(value: unknown): WhatsappWebhookEvent[] {
  const parsed = messagesValue.safeParse(value);
  if (!parsed.success) return [{ type: 'ignored', field: 'messages', reason: 'formato inválido' }];
  const { metadata, contacts = [], messages = [], statuses = [] } = parsed.data;
  const names = new Map(
    contacts.flatMap((c) => (c.wa_id ? [[c.wa_id, c.profile?.name ?? null] as const] : [])),
  );
  const events: WhatsappWebhookEvent[] = [];

  for (const raw of messages) {
    const item = inboundMessage.safeParse(raw);
    if (!item.success) {
      events.push({ type: 'ignored', field: 'messages', reason: 'mensagem fora do formato' });
      continue;
    }
    if (NOT_A_REPLY.has(item.data.type)) {
      events.push({ type: 'ignored', field: 'messages', reason: `tipo ${item.data.type}` });
      continue;
    }
    events.push({
      type: 'message',
      phoneNumberId: metadata?.phone_number_id ?? null,
      providerMessageId: item.data.id,
      from: item.data.from,
      profileName: names.get(item.data.from) ?? null,
      timestamp: item.data.timestamp,
      messageKind: item.data.type,
      text: inboundText(item.data),
    });
  }

  for (const raw of statuses) {
    const item = statusItem.safeParse(raw);
    const status = item.success ? STATUS[item.data.status] : undefined;
    if (!item.success || !status) {
      events.push({ type: 'ignored', field: 'messages', reason: 'status fora do formato' });
      continue;
    }
    const error = item.data.errors?.[0];
    events.push({
      type: 'status',
      providerMessageId: item.data.id,
      status,
      timestamp: item.data.timestamp,
      recipientId: item.data.recipient_id ?? null,
      reference: item.data.biz_opaque_callback_data ?? null,
      pricing: item.data.pricing
        ? {
            billable: item.data.pricing.billable ?? null,
            category: item.data.pricing.category ?? null,
            type: item.data.pricing.type ?? null,
          }
        : null,
      error: error
        ? {
            code: error.code,
            title: error.title ?? error.message ?? null,
            detail: error.error_data?.details ?? null,
          }
        : null,
    });
  }
  return events;
}

function parseChange(field: string, value: unknown): WhatsappWebhookEvent[] {
  switch (field) {
    case 'messages':
      return parseMessagesChange(value);
    case 'message_template_status_update': {
      const parsed = templateStatusValue.safeParse(value);
      return parsed.success
        ? [
            {
              type: 'template_status',
              metaTemplateId: parsed.data.message_template_id,
              status: parsed.data.event.toUpperCase(),
              reason:
                parsed.data.reason && parsed.data.reason !== 'NONE' ? parsed.data.reason : null,
            },
          ]
        : [{ type: 'ignored', field, reason: 'formato inválido' }];
    }
    case 'message_template_quality_update': {
      const parsed = templateQualityValue.safeParse(value);
      return parsed.success
        ? [
            {
              type: 'template_quality',
              metaTemplateId: parsed.data.message_template_id,
              qualityScore: parsed.data.new_quality_score.toUpperCase(),
            },
          ]
        : [{ type: 'ignored', field, reason: 'formato inválido' }];
    }
    case 'phone_number_quality_update':
    case 'account_update':
    case 'business_capability_update': {
      const event = z.object({ event: z.string().optional() }).safeParse(value);
      return [{ type: 'account', field, event: event.success ? (event.data.event ?? null) : null }];
    }
    default:
      return [{ type: 'ignored', field, reason: 'campo não usado' }];
  }
}

/** Corpo de webhook que não é do WhatsApp Business (ou fora do formato). */
export class MetaWebhookFormatError extends Error {
  constructor() {
    super('Webhook fora do formato do WhatsApp Business.');
    this.name = 'MetaWebhookFormatError';
  }
}

export function parseMetaWebhook(payload: unknown): WhatsappWebhookEvent[] {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) throw new MetaWebhookFormatError();
  return parsed.data.entry.flatMap((entry) =>
    entry.changes.flatMap((change) => parseChange(change.field, change.value)),
  );
}

/** Números (`wa_id`) citados no webhook, para a anonimização achar o payload depois. */
export function webhookContactIds(events: WhatsappWebhookEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === 'message') ids.add(event.from);
    if (event.type === 'status' && event.recipientId) ids.add(event.recipientId);
  }
  return [...ids];
}
