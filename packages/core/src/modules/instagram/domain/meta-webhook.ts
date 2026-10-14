import { z } from 'zod';

/**
 * Leitura do webhook do Instagram (formato da Meta para a API com Facebook
 * Login, docs/INTEGRATIONS.md §7.2): converte o corpo recebido em eventos do
 * domínio. Tolerante como o do WhatsApp: campos novos são ignorados e um item
 * fora do formato vira `ignored` sem derrubar os demais.
 *
 * Lidos: `messaging` (mensagens recebidas, ecos do que a conta da Docline
 * enviou e "visto") e o campo `comments` (comentários nas publicações da
 * Docline). Reações, menções e o resto viram `ignored`.
 */

export interface InstagramMessageEvent {
  type: 'message';
  /** Conta da Docline que recebeu o webhook. */
  accountId: string | null;
  /** IGSID da outra pessoa (quem escreveu ou, no eco, quem recebeu). */
  userId: string;
  providerMessageId: string;
  /** Mensagem enviada pela conta da Docline (pelo app ou pela API). */
  isEcho: boolean;
  timestamp: Date;
  /** text, image, video, audio, file, share, story_mention, ig_reel, postback… */
  messageKind: string;
  text: string | null;
}

export interface InstagramSeenEvent {
  type: 'seen';
  /** IGSID de quem leu. */
  userId: string;
  /** Mensagem lida (e as anteriores da conversa). */
  providerMessageId: string | null;
  timestamp: Date;
}

export interface InstagramCommentEvent {
  type: 'comment';
  accountId: string | null;
  commentId: string;
  /** IGSID e @ de quem comentou. */
  userId: string;
  username: string;
  mediaId: string;
  mediaProductType: string | null;
  parentCommentId: string | null;
  text: string | null;
  timestamp: Date;
}

export interface InstagramIgnoredEvent {
  type: 'ignored';
  field: string;
  reason: string;
}

export type InstagramWebhookEvent =
  InstagramMessageEvent | InstagramSeenEvent | InstagramCommentEvent | InstagramIgnoredEvent;

const idLike = z.union([z.string().min(1), z.number()]).transform(String);
/** A Meta manda milissegundos nas mensagens e segundos nos campos; os dois valem. */
const unixTime = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((v) => {
    const n = Number(v);
    return new Date(n > 1e12 ? n : n * 1000);
  });

const envelope = z.object({
  object: z.literal('instagram'),
  entry: z.array(
    z.object({
      id: idLike.optional(),
      time: unixTime.optional(),
      messaging: z.array(z.unknown()).default([]),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).default([]),
    }),
  ),
});

const messagingItem = z.object({
  sender: z.object({ id: idLike }),
  recipient: z.object({ id: idLike }),
  timestamp: unixTime,
  message: z
    .object({
      mid: z.string().min(1),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_self: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      is_unsupported: z.boolean().optional(),
      attachments: z.array(z.object({ type: z.string() })).optional(),
    })
    .optional(),
  postback: z
    .object({
      mid: z.string().min(1),
      title: z.string().optional(),
      payload: z.string().optional(),
    })
    .optional(),
  read: z.object({ mid: z.string().optional() }).optional(),
});

const commentValue = z.object({
  id: idLike.optional(),
  comment_id: idLike.optional(),
  text: z.string().optional(),
  parent_id: idLike.optional(),
  from: z.object({ id: idLike, username: z.string().min(1) }),
  media: z.object({ id: idLike, media_product_type: z.string().optional() }),
});

function parseMessaging(raw: unknown, accountId: string | null): InstagramWebhookEvent {
  const parsed = messagingItem.safeParse(raw);
  if (!parsed.success) return { type: 'ignored', field: 'messages', reason: 'fora do formato' };
  const { sender, recipient, timestamp, message, postback, read } = parsed.data;

  if (read) {
    return {
      type: 'seen',
      userId: sender.id,
      providerMessageId: read.mid ?? null,
      timestamp,
    };
  }
  if (postback) {
    return {
      type: 'message',
      accountId,
      userId: sender.id,
      providerMessageId: postback.mid,
      isEcho: false,
      timestamp,
      messageKind: 'postback',
      text: postback.title ?? postback.payload ?? null,
    };
  }
  if (!message) return { type: 'ignored', field: 'messages', reason: 'evento sem mensagem' };
  // Mensagem de teste para a própria conta, apagada ou que a Meta não mostra.
  if (message.is_self) return { type: 'ignored', field: 'messages', reason: 'mensagem de teste' };
  if (message.is_deleted) return { type: 'ignored', field: 'messages', reason: 'apagada' };
  const isEcho = message.is_echo === true;
  const kind = message.text
    ? 'text'
    : message.is_unsupported
      ? 'unsupported'
      : (message.attachments?.[0]?.type ?? 'unknown');
  return {
    type: 'message',
    accountId,
    userId: isEcho ? recipient.id : sender.id,
    providerMessageId: message.mid,
    isEcho,
    timestamp,
    messageKind: kind,
    text: message.text ?? null,
  };
}

function parseChange(
  field: string,
  value: unknown,
  accountId: string | null,
  time: Date | undefined,
): InstagramWebhookEvent {
  if (field !== 'comments') return { type: 'ignored', field, reason: 'campo não usado' };
  const parsed = commentValue.safeParse(value);
  const commentId = parsed.success ? (parsed.data.id ?? parsed.data.comment_id) : undefined;
  if (!parsed.success || !commentId) {
    return { type: 'ignored', field, reason: 'formato inválido' };
  }
  return {
    type: 'comment',
    accountId,
    commentId,
    userId: parsed.data.from.id,
    username: parsed.data.from.username,
    mediaId: parsed.data.media.id,
    mediaProductType: parsed.data.media.media_product_type ?? null,
    parentCommentId: parsed.data.parent_id ?? null,
    text: parsed.data.text ?? null,
    timestamp: time ?? new Date(0),
  };
}

/** Corpo de webhook que não é do Instagram (ou fora do formato). */
export class InstagramWebhookFormatError extends Error {
  constructor() {
    super('Webhook fora do formato do Instagram.');
    this.name = 'InstagramWebhookFormatError';
  }
}

export function parseInstagramWebhook(payload: unknown): InstagramWebhookEvent[] {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) throw new InstagramWebhookFormatError();
  return parsed.data.entry.flatMap((entry) => {
    const accountId = entry.id ?? null;
    return [
      ...entry.messaging.map((item) => parseMessaging(item, accountId)),
      ...entry.changes.map((change) =>
        parseChange(change.field, change.value, accountId, entry.time),
      ),
    ];
  });
}

/** IGSIDs e @ citados no webhook, para a anonimização achar o payload depois. */
export function instagramWebhookContacts(events: InstagramWebhookEvent[]): {
  userIds: string[];
  usernames: string[];
} {
  const userIds = new Set<string>();
  const usernames = new Set<string>();
  for (const event of events) {
    if (event.type === 'message' || event.type === 'seen') userIds.add(event.userId);
    if (event.type === 'comment') {
      userIds.add(event.userId);
      usernames.add(event.username.toLowerCase());
    }
  }
  return { userIds: [...userIds], usernames: [...usernames] };
}

const KIND_LABELS: Record<string, string> = {
  image: '[Imagem]',
  video: '[Vídeo]',
  audio: '[Áudio]',
  file: '[Arquivo]',
  share: '[Publicação compartilhada]',
  story_mention: '[Menção num story]',
  ig_reel: '[Reel]',
  reel: '[Reel]',
  unsupported: '[Mensagem que a Meta não mostra pela API]',
};

/** Texto gravado para uma mensagem recebida (mídia sem texto vira um rótulo). */
export function instagramMessageBody(kind: string, text: string | null): string {
  const trimmed = text?.trim() ?? '';
  if (trimmed) return trimmed;
  return KIND_LABELS[kind] ?? `[Mensagem do tipo ${kind}]`;
}
