import type { UseCaseContext } from '../../../shared/use-case';
import { auditLead } from '../../leads';
import { recordOutboundSent } from '../../messaging';
import { describeWhatsappError } from '../domain/errors';
import { applySendFailure } from './effects';

/**
 * Desfecho de um envio pela API, usado pelo job (resposta da Meta) e pelos
 * webhooks de status (que podem chegar antes, junto ou no lugar da resposta).
 * A atualização é condicional: só uma transação consegue marcar a mensagem,
 * então os efeitos (contato registrado, tarefa, etapa, evento) acontecem uma vez.
 */

/** Marca como enviada (a partir de "na fila" ou de uma falha de resultado incerto). */
export async function markMessageSent(
  ctx: UseCaseContext,
  messageId: string,
  options: { providerMessageId: string; sentAt: Date; waId?: string | null },
): Promise<boolean> {
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
      conversation: { select: { externalThreadId: true } },
    },
  });
  const lead = await ctx.tx.lead.findUniqueOrThrow({
    where: { id: message.leadId },
    select: { firstContactAt: true },
  });
  const changed = await ctx.tx.message.updateMany({
    where: { id: messageId, status: { in: ['QUEUED', 'FAILED'] } },
    data: {
      status: 'SENT',
      sentAt: options.sentAt,
      providerMessageId: options.providerMessageId,
      isFirstContact: lead.firstContactAt === null,
      failedAt: null,
      errorCode: null,
      errorDetail: null,
    },
  });
  if (changed.count === 0) {
    // Já marcada (pelo webhook ou pelo job): só garante o id do provedor.
    await ctx.tx.message.updateMany({
      where: { id: messageId, providerMessageId: null },
      data: { providerMessageId: options.providerMessageId },
    });
    return false;
  }
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
    // A Meta pode identificar o número sem o 9º dígito: a conversa passa a usar o wa_id dela.
    const waId = options.waId;
    if (waId && waId !== message.conversation?.externalThreadId) {
      const taken = await ctx.tx.conversation.findFirst({
        where: { leadId: message.leadId, channel: 'WHATSAPP', externalThreadId: waId },
        select: { id: true },
      });
      if (!taken) {
        await ctx.tx.conversation.update({
          where: { id: message.conversationId },
          data: { externalThreadId: waId },
        });
      }
    }
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

/** Marca como falha (só a partir de "na fila", ou de "enviada" quando a Meta avisa a falha). */
export async function markMessageFailed(
  ctx: UseCaseContext,
  messageId: string,
  options: {
    code: string;
    detail?: string;
    failedAt: Date;
    from: ('QUEUED' | 'SENT')[];
    webhookEventId?: string | null;
  },
): Promise<boolean> {
  const changed = await ctx.tx.message.updateMany({
    where: { id: messageId, status: { in: options.from } },
    data: {
      status: 'FAILED',
      failedAt: options.failedAt,
      errorCode: options.code,
      errorDetail: options.detail ?? describeWhatsappError(options.code).message,
    },
  });
  if (changed.count === 0) return false;
  const message = await ctx.tx.message.findUniqueOrThrow({
    where: { id: messageId },
    select: { id: true, leadId: true, contactPointId: true, createdById: true, provider: true },
  });
  await ctx.tx.messageStatusEvent.upsert({
    where: { messageId_status: { messageId, status: 'FAILED' } },
    create: {
      messageId,
      status: 'FAILED',
      occurredAt: options.failedAt,
      errorCode: options.code,
      webhookEventId: options.webhookEventId ?? null,
    },
    update: { occurredAt: options.failedAt, errorCode: options.code },
  });
  await applySendFailure(ctx, message, options.code, message.provider ?? 'whatsapp');
  await auditLead(ctx, message.leadId, 'whatsapp.failed', {
    subjectId: message.id,
    metadata: { code: options.code },
  });
  return true;
}
