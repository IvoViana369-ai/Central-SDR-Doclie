import { JOBS } from '../../../jobs/catalog';
import type { UseCaseContext } from '../../../shared/use-case';
import { applyInboundReply } from '../../messaging';
import { e164FromWhatsappId, whatsappIdVariants } from '../../normalization';
import { notify } from '../../notifications';
import { resolveWhatsappSettings, WHATSAPP_SETTINGS_KEY } from '../domain/settings';
import { serviceWindowExpiry } from '../domain/window';

/**
 * Mensagens recebidas pelo WhatsApp (F7-02, F7-06): de que lead e número são,
 * a conversa com a janela de atendimento e o registro como resposta.
 */

export type InboundMatch =
  | { kind: 'matched'; leadId: string; contactPointId: string | null }
  | { kind: 'unmatched'; phoneE164: string | null; candidateLeadIds: string[] };

const LIVE_LEAD = { status: { in: ['ACTIVE' as const, 'ARCHIVED' as const] } };

/**
 * Casamento do `wa_id` com o lead (docs/INTEGRATIONS.md §6.2): primeiro a
 * conversa já existente com esse contato; depois o telefone do lead, com e sem
 * o 9º dígito. Mais de um lead com o número: fica o que recebeu a última
 * mensagem por esse número; sem isso, uma pessoa decide (nunca adivinha).
 */
export async function matchInbound(ctx: UseCaseContext, waId: string): Promise<InboundMatch> {
  const e164 = e164FromWhatsappId(waId);
  const threadIds = [...new Set([waId, ...(e164 ? whatsappIdVariants(e164) : [])])];
  const conversation = await ctx.tx.conversation.findFirst({
    where: { channel: 'WHATSAPP', externalThreadId: { in: threadIds }, lead: LIVE_LEAD },
    orderBy: [{ lastOutboundAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    select: { leadId: true, contactPointId: true },
  });
  if (conversation) return { kind: 'matched', ...conversation };
  if (!e164) return { kind: 'unmatched', phoneE164: null, candidateLeadIds: [] };

  const points = await ctx.tx.contactPoint.findMany({
    where: { type: 'PHONE', valueNormalized: e164, status: { not: 'REMOVED' }, lead: LIVE_LEAD },
    select: { id: true, leadId: true },
  });
  const leadIds = [...new Set(points.map((p) => p.leadId))];
  if (leadIds.length === 1) {
    return { kind: 'matched', leadId: leadIds[0]!, contactPointId: points[0]!.id };
  }
  if (leadIds.length > 1) {
    const last = await ctx.tx.message.findFirst({
      where: {
        contactPointId: { in: points.map((p) => p.id) },
        direction: 'OUTBOUND',
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
      },
      orderBy: { sentAt: 'desc' },
      select: { leadId: true, contactPointId: true },
    });
    if (last) return { kind: 'matched', leadId: last.leadId, contactPointId: last.contactPointId };
  }
  return { kind: 'unmatched', phoneE164: e164, candidateLeadIds: leadIds };
}

/** Conversa do número: cria ou atualiza a janela de atendimento (24 h da mensagem do contato). */
async function touchConversation(
  ctx: UseCaseContext,
  leadId: string,
  contactPointId: string | null,
  waId: string,
  profileName: string | null,
  receivedAt: Date,
) {
  const existing = await ctx.tx.conversation.findFirst({
    where: {
      leadId,
      channel: 'WHATSAPP',
      OR: [{ externalThreadId: waId }, ...(contactPointId ? [{ contactPointId }] : [])],
    },
    orderBy: { updatedAt: 'desc' },
  });
  const expires = serviceWindowExpiry(receivedAt);
  if (!existing) {
    return ctx.tx.conversation.create({
      data: {
        leadId,
        channel: 'WHATSAPP',
        contactPointId,
        externalThreadId: waId,
        profileName,
        lastInboundAt: receivedAt,
        serviceWindowExpiresAt: expires,
      },
    });
  }
  const later = (a: Date | null) => (!a || receivedAt > a ? receivedAt : a);
  const threadTaken =
    existing.externalThreadId !== waId &&
    (await ctx.tx.conversation.count({
      where: { leadId, channel: 'WHATSAPP', externalThreadId: waId },
    })) > 0;
  return ctx.tx.conversation.update({
    where: { id: existing.id },
    data: {
      // O wa_id que a Meta usa para o número passa a ser o da conversa.
      ...(threadTaken ? {} : { externalThreadId: waId }),
      contactPointId: existing.contactPointId ?? contactPointId,
      profileName: profileName ?? existing.profileName,
      lastInboundAt: later(existing.lastInboundAt),
      serviceWindowExpiresAt:
        existing.serviceWindowExpiresAt && existing.serviceWindowExpiresAt > expires
          ? existing.serviceWindowExpiresAt
          : expires,
    },
  });
}

/**
 * Grava a mensagem recebida no lead: conversa e janela, número confirmado no
 * WhatsApp, resposta (cadência, opt-out, etapa, tarefa, score), aviso ao
 * responsável e, se configurado, a sugestão de classificação pela IA (F7-07).
 */
export async function attachInbound(
  ctx: UseCaseContext,
  match: { leadId: string; contactPointId: string | null },
  inbound: {
    waId: string;
    profileName: string | null;
    providerMessageId: string;
    provider: string;
    receivedAt: Date;
    body: string;
  },
) {
  const lead = await ctx.tx.lead.findUniqueOrThrow({
    where: { id: match.leadId },
    select: { id: true, ownerId: true, municipalityCode: true, stateUf: true, displayName: true },
  });
  const conversation = await touchConversation(
    ctx,
    lead.id,
    match.contactPointId,
    inbound.waId,
    inbound.profileName,
    inbound.receivedAt,
  );
  if (match.contactPointId) {
    await ctx.tx.contactPoint.updateMany({
      where: { id: match.contactPointId, whatsappStatus: { not: 'CONFIRMED' } },
      data: { whatsappStatus: 'CONFIRMED' },
    });
  }
  const result = await applyInboundReply(ctx, lead, {
    channel: 'WHATSAPP',
    contactPointId: match.contactPointId,
    body: inbound.body,
    receivedAt: inbound.receivedAt,
    mode: 'API',
    provider: inbound.provider,
    providerMessageId: inbound.providerMessageId,
    conversationId: conversation.id,
  });
  if (lead.ownerId) {
    await notify(ctx.tx, {
      userId: lead.ownerId,
      type: 'whatsapp.received',
      title: `Nova mensagem no WhatsApp: ${lead.displayName}`,
      body:
        result.classification === 'OPT_OUT'
          ? 'Pediu para não receber mais mensagens: o lead foi para a Lista Não Contatar.'
          : null,
      leadId: lead.id,
    });
  }
  if (!result.classification) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
    if (resolveWhatsappSettings(row?.value).autoSuggestClassification) {
      await ctx.deps.jobs.enqueue(
        JOBS.whatsappSuggestClassification.name,
        { messageId: result.messageId },
        { tx: ctx.tx, singletonKey: result.messageId },
      );
    }
  }
  return result;
}

const KIND_LABELS: Record<string, string> = {
  image: '[Imagem]',
  video: '[Vídeo]',
  audio: '[Áudio]',
  voice: '[Áudio]',
  document: '[Documento]',
  sticker: '[Figurinha]',
  location: '[Localização]',
  contacts: '[Contato compartilhado]',
  order: '[Pedido]',
};

/** Texto da mensagem recebida; mídia sem legenda vira um rótulo (a mídia não é baixada). */
export function inboundBody(kind: string, text: string | null): string {
  const label = KIND_LABELS[kind];
  const trimmed = text?.trim() ?? '';
  if (label) return trimmed ? `${label} ${trimmed}` : label;
  return trimmed || `[Mensagem do tipo ${kind}]`;
}
