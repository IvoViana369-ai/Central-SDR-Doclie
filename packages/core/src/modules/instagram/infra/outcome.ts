import type { UseCaseContext } from '../../../shared/use-case';
import { auditLead } from '../../leads';
import { recordOutboundSent } from '../../messaging';
import { notify } from '../../notifications';
import { describeInstagramError } from '../domain/errors';
import { markInstagramConnection } from './connection';

/**
 * Desfecho de um envio pelo Instagram, usado pelo job (resposta da Meta) e
 * pelo eco no webhook (que pode chegar antes da resposta, ou no lugar dela).
 * A atualização é condicional, como no WhatsApp (ADR 022): só uma transação
 * marca a mensagem, então os efeitos acontecem uma vez.
 */

/** Marca como enviada (a partir de "na fila" ou de uma falha de resultado incerto). */
export async function markInstagramSent(
  ctx: UseCaseContext,
  messageId: string,
  options: { providerMessageId: string; sentAt: Date; recipientId?: string | null },
): Promise<boolean> {
  const changed = await ctx.tx.message.updateMany({
    where: { id: messageId, status: { in: ['QUEUED', 'FAILED'] } },
    data: {
      status: 'SENT',
      sentAt: options.sentAt,
      providerMessageId: options.providerMessageId,
      failedAt: null,
      errorCode: null,
      errorDetail: null,
    },
  });
  if (changed.count === 0) {
    // Já marcada (pelo eco ou pelo job): só garante o id da Meta.
    await ctx.tx.message.updateMany({
      where: { id: messageId, providerMessageId: null },
      data: { providerMessageId: options.providerMessageId },
    });
    return false;
  }
  const message = await ctx.tx.message.findUniqueOrThrow({
    where: { id: messageId },
    select: {
      id: true,
      leadId: true,
      channel: true,
      mode: true,
      messageType: true,
      taskId: true,
      aiGenerationId: true,
      conversationId: true,
      privateReplyFor: {
        select: { id: true, externalUserId: true, contactPointId: true, authorHandle: true },
      },
    },
  });
  await ctx.tx.messageStatusEvent.upsert({
    where: { messageId_status: { messageId, status: 'SENT' } },
    create: { messageId, status: 'SENT', occurredAt: options.sentAt },
    update: {},
  });
  if (message.conversationId) {
    await ctx.tx.conversation.update({
      where: { id: message.conversationId },
      data: { lastOutboundAt: options.sentAt },
    });
  } else if (message.privateReplyFor) {
    // Resposta privada: a conversa com quem comentou começa aqui (o IGSID
    // vem no comentário). A janela de 24 h só abre quando a pessoa responder.
    const comment = message.privateReplyFor;
    const conversation = await ctx.tx.conversation.upsert({
      where: {
        leadId_channel_externalThreadId: {
          leadId: message.leadId,
          channel: 'INSTAGRAM',
          externalThreadId: options.recipientId ?? comment.externalUserId,
        },
      },
      create: {
        leadId: message.leadId,
        channel: 'INSTAGRAM',
        contactPointId: comment.contactPointId,
        externalThreadId: options.recipientId ?? comment.externalUserId,
        handle: comment.authorHandle,
        lastOutboundAt: options.sentAt,
      },
      update: { lastOutboundAt: options.sentAt },
    });
    await ctx.tx.message.update({
      where: { id: message.id },
      data: { conversationId: conversation.id },
    });
  }
  if (message.aiGenerationId) {
    await ctx.tx.aiGeneration.update({
      where: { id: message.aiGenerationId },
      data: { status: 'SENT' },
    });
  }
  await recordOutboundSent(ctx, message, options.sentAt, message.taskId);
  return true;
}

/** Marca como falha (só a partir de "na fila"). */
export async function markInstagramFailed(
  ctx: UseCaseContext,
  messageId: string,
  options: { code: string; detail?: string; failedAt: Date },
): Promise<boolean> {
  const changed = await ctx.tx.message.updateMany({
    where: { id: messageId, status: 'QUEUED' },
    data: {
      status: 'FAILED',
      failedAt: options.failedAt,
      errorCode: options.code,
      errorDetail: options.detail ?? describeInstagramError(options.code).message,
    },
  });
  if (changed.count === 0) return false;
  const message = await ctx.tx.message.findUniqueOrThrow({
    where: { id: messageId },
    select: { id: true, leadId: true, createdById: true, provider: true },
  });
  await ctx.tx.messageStatusEvent.upsert({
    where: { messageId_status: { messageId, status: 'FAILED' } },
    create: {
      messageId,
      status: 'FAILED',
      occurredAt: options.failedAt,
      errorCode: options.code,
    },
    update: { occurredAt: options.failedAt, errorCode: options.code },
  });
  const { kind, message: explanation } = describeInstagramError(options.code);
  if (kind === 'AUTH') {
    await markInstagramConnection(ctx, message.provider ?? 'instagram', 'ERROR', explanation);
  }
  if (message.createdById) {
    const lead = await ctx.tx.lead.findUnique({
      where: { id: message.leadId },
      select: { displayName: true },
    });
    await notify(ctx.tx, {
      userId: message.createdById,
      type: 'instagram.failed',
      title: `Instagram não enviado para ${lead?.displayName ?? 'o lead'}`,
      body: explanation,
      leadId: message.leadId,
    });
  }
  await auditLead(ctx, message.leadId, 'instagram.failed', {
    subjectId: message.id,
    metadata: { code: options.code },
  });
  return true;
}
