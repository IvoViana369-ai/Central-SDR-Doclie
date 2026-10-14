import { JOBS } from '../../../jobs/catalog';
import type { UseCaseContext } from '../../../shared/use-case';
import { applyInboundReply } from '../../messaging';
import { normalizeInstagram } from '../../normalization';
import { notify } from '../../notifications';
import { INSTAGRAM_SETTINGS_KEY, resolveInstagramSettings } from '../domain/settings';
import { messagingWindowExpiry } from '../domain/window';

/**
 * Mensagens recebidas pelo Instagram (F8-02): de que lead são, a conversa com
 * a janela de 24 h e o registro como resposta (mesmas regras do WhatsApp e do
 * "Registrar resposta": opt-out, cadência, etapa, tarefa).
 */

export type InstagramMatch =
  | { kind: 'matched'; leadId: string; contactPointId: string | null }
  | { kind: 'unmatched'; candidateLeadIds: string[] };

const LIVE_LEAD = { status: { in: ['ACTIVE' as const, 'ARCHIVED' as const] } };

/** @ normalizado (o da Meta já vem sem "@"; normaliza por segurança). */
export function instagramHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeInstagram(value);
  return normalized.ok ? normalized.value.handle : null;
}

/**
 * Casamento de quem escreveu com o lead: primeiro a conversa já existente com
 * esse IGSID; depois o @ cadastrado no lead. Mais de um lead com o @: fica o
 * que recebeu a última mensagem pelo Instagram; sem isso, uma pessoa decide.
 */
export async function matchInstagramInbound(
  ctx: UseCaseContext,
  igsid: string,
  handle: string | null,
): Promise<InstagramMatch> {
  const conversation = await ctx.tx.conversation.findFirst({
    where: { channel: 'INSTAGRAM', externalThreadId: igsid, lead: LIVE_LEAD },
    orderBy: [{ lastOutboundAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    select: { leadId: true, contactPointId: true },
  });
  if (conversation) return { kind: 'matched', ...conversation };
  if (!handle) return { kind: 'unmatched', candidateLeadIds: [] };

  const points = await ctx.tx.contactPoint.findMany({
    where: {
      type: 'INSTAGRAM',
      valueNormalized: handle,
      status: { not: 'REMOVED' },
      lead: LIVE_LEAD,
    },
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
  return { kind: 'unmatched', candidateLeadIds: leadIds };
}

/** Conversa com quem escreveu: cria ou atualiza a janela de 24 h. */
async function touchConversation(
  ctx: UseCaseContext,
  leadId: string,
  contactPointId: string | null,
  inbound: { igsid: string; handle: string | null; name: string | null; receivedAt: Date },
) {
  const expires = messagingWindowExpiry(inbound.receivedAt);
  const existing = await ctx.tx.conversation.findUnique({
    where: {
      leadId_channel_externalThreadId: {
        leadId,
        channel: 'INSTAGRAM',
        externalThreadId: inbound.igsid,
      },
    },
  });
  if (!existing) {
    return ctx.tx.conversation.create({
      data: {
        leadId,
        channel: 'INSTAGRAM',
        contactPointId,
        externalThreadId: inbound.igsid,
        handle: inbound.handle,
        profileName: inbound.name,
        lastInboundAt: inbound.receivedAt,
        serviceWindowExpiresAt: expires,
      },
    });
  }
  const later = (a: Date | null) => (!a || inbound.receivedAt > a ? inbound.receivedAt : a);
  return ctx.tx.conversation.update({
    where: { id: existing.id },
    data: {
      contactPointId: existing.contactPointId ?? contactPointId,
      handle: inbound.handle ?? existing.handle,
      profileName: inbound.name ?? existing.profileName,
      lastInboundAt: later(existing.lastInboundAt),
      serviceWindowExpiresAt:
        existing.serviceWindowExpiresAt && existing.serviceWindowExpiresAt > expires
          ? existing.serviceWindowExpiresAt
          : expires,
    },
  });
}

/**
 * Grava a mensagem recebida no lead: conversa e janela, resposta (cadência,
 * opt-out, etapa, tarefa, score), aviso ao responsável e, se configurado, a
 * sugestão de classificação pela IA.
 */
export async function attachInstagramInbound(
  ctx: UseCaseContext,
  match: { leadId: string; contactPointId: string | null },
  inbound: {
    igsid: string;
    handle: string | null;
    name: string | null;
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
  const conversation = await touchConversation(ctx, lead.id, match.contactPointId, inbound);
  const result = await applyInboundReply(ctx, lead, {
    channel: 'INSTAGRAM',
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
      type: 'instagram.received',
      title: `Nova mensagem no Instagram: ${lead.displayName}`,
      body:
        result.classification === 'OPT_OUT'
          ? 'Pediu para não receber mais mensagens: o lead foi para a Lista Não Contatar.'
          : null,
      leadId: lead.id,
    });
  }
  if (!result.classification) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } });
    if (resolveInstagramSettings(row?.value).autoSuggestClassification) {
      await ctx.deps.jobs.enqueue(
        JOBS.instagramSuggestClassification.name,
        { messageId: result.messageId },
        { tx: ctx.tx, singletonKey: result.messageId },
      );
    }
  }
  return result;
}
