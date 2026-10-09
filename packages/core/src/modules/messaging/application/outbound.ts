import type { Prisma } from '@docline/db';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { evaluateLeadGate } from '../../compliance';
import { auditLead, LEAD_EVENTS, requireEditableLead, requireLeadInScope } from '../../leads';
import { formatPhone, whatsappLink } from '../../normalization';
import { closeTask, registerOutboundContact } from '../../tasks';
import {
  confirmMessageInput,
  leadMessagesInput,
  logOutboundMessageInput,
  messageIdInput,
  prepareMessageInput,
} from '../contracts/schemas';
import {
  MESSAGE_STATUS_LABELS,
  MESSAGE_TYPE_LABELS,
  REPLY_CLASSIFICATION_LABELS,
  type AssistedChannel,
} from '../domain/labels';

export const messageSelect = {
  id: true,
  leadId: true,
  contactPointId: true,
  channel: true,
  direction: true,
  mode: true,
  messageType: true,
  body: true,
  status: true,
  isFirstContact: true,
  taskId: true,
  enrollmentId: true,
  sentAt: true,
  receivedAt: true,
  createdAt: true,
  classification: true,
  classificationSource: true,
  optOutMatch: true,
  aiGenerationId: true,
  approachId: true,
  contactPoint: { select: { id: true, type: true, valueNormalized: true } },
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

function contactDisplay(cp: { type: string; valueNormalized: string } | null): string | null {
  if (!cp) return null;
  if (cp.type === 'PHONE') return formatPhone(cp.valueNormalized);
  if (cp.type === 'INSTAGRAM') return `@${cp.valueNormalized}`;
  return cp.valueNormalized;
}

export function describeMessage(m: MessageRow) {
  return {
    ...m,
    contactPoint: m.contactPoint
      ? {
          id: m.contactPoint.id,
          type: m.contactPoint.type,
          display: contactDisplay(m.contactPoint),
        }
      : null,
    statusLabel: MESSAGE_STATUS_LABELS[m.status],
    messageTypeLabel: m.messageType ? MESSAGE_TYPE_LABELS[m.messageType] : null,
    classificationLabel: m.classification ? REPLY_CLASSIFICATION_LABELS[m.classification] : null,
  };
}

/** Link que abre o app com o contato (e o texto, quando o canal permite). */
function assistedLink(channel: AssistedChannel, value: string, body: string): string | null {
  switch (channel) {
    case 'WHATSAPP':
      return whatsappLink(value, body);
    case 'INSTAGRAM':
      // O Instagram não aceita texto no link: a tela copia a mensagem e abre o perfil.
      return `https://www.instagram.com/${encodeURIComponent(value)}/`;
    case 'EMAIL':
      return `mailto:${value}?body=${encodeURIComponent(body)}`;
  }
}

/** Mensagem de um lead no escopo do ator (fora do escopo, "não existe"). */
async function requireMessage(ctx: UseCaseContext, messageId: string) {
  const message = await ctx.tx.message.findUnique({
    where: { id: messageId },
    select: messageSelect,
  });
  if (!message) throw new NotFoundError('Mensagem não encontrada.');
  await requireLeadInScope(ctx, message.leadId, { id: true });
  return message;
}

/** Tarefa aberta do lead que o envio cumpre (ex.: passo da cadência). */
async function openTaskOf(ctx: UseCaseContext, leadId: string, taskId: string | null | undefined) {
  if (!taskId) return null;
  const task = await ctx.tx.task.findFirst({
    where: { id: taskId, leadId, status: 'OPEN' },
    select: {
      id: true,
      leadId: true,
      type: true,
      title: true,
      messageType: true,
      enrollmentId: true,
      cadenceStepId: true,
    },
  });
  if (!task) throw new NotFoundError('Tarefa aberta não encontrada neste lead.');
  return task;
}

/**
 * Depois de um envio (confirmado, registrado ou aceito pela API do WhatsApp):
 * datas de contato, etapa de primeiro contato, tarefa cumprida, evento e auditoria.
 */
export async function recordOutboundSent(
  ctx: UseCaseContext,
  message: {
    id: string;
    leadId: string;
    channel: string;
    mode: string;
    messageType: string | null;
  },
  sentAt: Date,
  taskId: string | null,
) {
  await registerOutboundContact(ctx, message.leadId, sentAt);
  // A tarefa pode ter sido fechada entre preparar e confirmar (ex.: cadência encerrada).
  const task = taskId
    ? await ctx.tx.task.findFirst({
        where: { id: taskId, leadId: message.leadId, status: 'OPEN' },
        select: { id: true, leadId: true, type: true, title: true, enrollmentId: true },
      })
    : null;
  if (task) await closeTask(ctx, task, 'DONE', 'Mensagem enviada.', sentAt);
  await ctx.tx.leadEvent.create({
    data: {
      leadId: message.leadId,
      type: LEAD_EVENTS.messageSent,
      occurredAt: sentAt,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      subjectType: 'message',
      subjectId: message.id,
      channel: message.channel as Prisma.LeadEventCreateInput['channel'],
      payload: toJson({ mode: message.mode, messageType: message.messageType }),
    },
  });
  await auditLead(ctx, message.leadId, 'message.sent', {
    subjectId: message.id,
    metadata: { channel: message.channel, mode: message.mode, messageType: message.messageType },
  });
}

/**
 * Contato assistido (F5-09; docs/SDR-FLOW.md §6): confere o gate completo,
 * guarda a mensagem como "aguardando confirmação" e devolve o link do app
 * (`wa.me` com o texto, perfil do Instagram, e-mail). O humano envia.
 */
export const prepareAssistedMessage = defineUseCase({
  name: 'messaging.prepare',
  access: 'lead.update',
  input: prepareMessageInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const gate = await evaluateLeadGate(ctx.tx, lead.id, {
      mode: 'ASSISTED',
      actor: ctx.actor,
      now: ctx.now,
    });
    const channel = gate.channels.find((c) => c.channel === input.channel)!;
    if (!channel.allowed) throw new BusinessRuleError(channel.reasons.join(' '));
    const contactPointId = input.contactPointId ?? channel.usableContactPointIds[0];
    if (!contactPointId || !channel.usableContactPointIds.includes(contactPointId)) {
      throw new BusinessRuleError('Este contato não pode ser usado neste canal.');
    }
    const contactPoint = await ctx.tx.contactPoint.findUniqueOrThrow({
      where: { id: contactPointId },
      select: { id: true, type: true, valueNormalized: true },
    });
    // Sem tarefa informada, o envio cumpre o passo da cadência que já venceu (se houver).
    const task = input.taskId
      ? await openTaskOf(ctx, lead.id, input.taskId)
      : await ctx.tx.task.findFirst({
          where: {
            leadId: lead.id,
            status: 'OPEN',
            enrollmentId: { not: null },
            dueAt: { lte: ctx.now },
          },
          select: {
            id: true,
            leadId: true,
            type: true,
            title: true,
            messageType: true,
            enrollmentId: true,
            cadenceStepId: true,
          },
        });

    // Rascunho da IA: só o aprovado, com o texto aprovado (docs/AI-SDR.md §10).
    const generation = input.aiGenerationId
      ? await ctx.tx.aiGeneration.findFirst({
          where: { id: input.aiGenerationId, leadId: lead.id },
          select: {
            id: true,
            status: true,
            kind: true,
            textFinal: true,
            approachId: true,
            approvedById: true,
            approvedAt: true,
          },
        })
      : null;
    if (input.aiGenerationId && (generation?.status !== 'APPROVED' || !generation.textFinal)) {
      throw new BusinessRuleError('O rascunho da IA precisa estar aprovado para ser enviado.');
    }
    const body = generation?.textFinal ?? input.body;

    // Um envio pendente por lead e canal: preparar de novo substitui o anterior.
    await ctx.tx.message.updateMany({
      where: {
        leadId: lead.id,
        channel: input.channel,
        status: 'PENDING_CONFIRMATION',
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      data: { status: 'CANCELED', canceledAt: ctx.now },
    });
    if (
      generation &&
      (await ctx.tx.message.count({
        where: { aiGenerationId: generation.id, status: { not: 'CANCELED' } },
      })) > 0
    ) {
      throw new BusinessRuleError('Este rascunho já tem um envio feito ou em andamento.');
    }
    const message = await ctx.tx.message.create({
      data: {
        leadId: lead.id,
        contactPointId: contactPoint.id,
        channel: input.channel,
        direction: 'OUTBOUND',
        mode: 'ASSISTED',
        messageType:
          task?.messageType ??
          (generation && generation.kind !== 'REPLY_CLASSIFICATION' ? generation.kind : null) ??
          input.messageType,
        body,
        status: 'PENDING_CONFIRMATION',
        aiGenerationId: generation?.id ?? null,
        approachId: generation?.approachId ?? null,
        approvedById: generation?.approvedById ?? null,
        approvedAt: generation?.approvedAt ?? null,
        taskId: task?.id ?? null,
        enrollmentId: task?.enrollmentId ?? null,
        cadenceStepId: task?.cadenceStepId ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      select: messageSelect,
    });
    return {
      message: describeMessage(message),
      link: assistedLink(input.channel, contactPoint.valueNormalized, body),
    };
  },
});

/** "Confirmar envio": o humano enviou no app; registra e avança (etapa, tarefa, cadência). */
export const confirmAssistedMessage = defineUseCase({
  name: 'messaging.confirm',
  access: 'lead.update',
  input: confirmMessageInput,
  async run(ctx, input) {
    const message = await requireMessage(ctx, input.messageId);
    if (message.status !== 'PENDING_CONFIRMATION') {
      throw new BusinessRuleError('Este envio já foi confirmado ou cancelado.');
    }
    const sentAt = input.sentAt ?? ctx.now;
    if (sentAt > ctx.now) throw new BusinessRuleError('A data do envio não pode estar no futuro.');
    const lead = await ctx.tx.lead.findUniqueOrThrow({
      where: { id: message.leadId },
      select: { firstContactAt: true },
    });
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt,
        sentById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        isFirstContact: lead.firstContactAt === null,
      },
    });
    if (message.aiGenerationId) {
      await ctx.tx.aiGeneration.update({
        where: { id: message.aiGenerationId },
        data: { status: 'SENT' },
      });
    }
    await recordOutboundSent(ctx, message, sentAt, message.taskId);
    return describeMessage(
      await ctx.tx.message.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect }),
    );
  },
});

/** Desistiu de enviar: a pendência sai da fila. */
export const cancelAssistedMessage = defineUseCase({
  name: 'messaging.cancel',
  access: 'lead.update',
  input: messageIdInput,
  async run(ctx, input) {
    const message = await requireMessage(ctx, input.messageId);
    if (message.status !== 'PENDING_CONFIRMATION') {
      throw new BusinessRuleError('Só envios aguardando confirmação podem ser cancelados.');
    }
    await ctx.tx.message.update({
      where: { id: message.id },
      data: { status: 'CANCELED', canceledAt: ctx.now },
    });
    return { messageId: message.id, status: 'CANCELED' as const };
  },
});

/**
 * "Registrar contato" (docs/SDR-FLOW.md §6, modo LOGGED): mensagem enviada fora
 * do fluxo. É o registro do que já aconteceu; o gate vale para os próximos.
 */
export const logOutboundMessage = defineUseCase({
  name: 'messaging.logOutbound',
  access: 'lead.update',
  input: logOutboundMessageInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true, firstContactAt: true });
    if (input.sentAt > ctx.now) {
      throw new BusinessRuleError(
        'Registre só o que já aconteceu (para o futuro, crie uma tarefa).',
      );
    }
    if (input.contactPointId) {
      const cp = await ctx.tx.contactPoint.findFirst({
        where: { id: input.contactPointId, leadId: lead.id },
        select: { id: true },
      });
      if (!cp) throw new NotFoundError('Contato não encontrado neste lead.');
    }
    const task = await openTaskOf(ctx, lead.id, input.taskId);
    const message = await ctx.tx.message.create({
      data: {
        leadId: lead.id,
        contactPointId: input.contactPointId ?? null,
        channel: input.channel,
        direction: 'OUTBOUND',
        mode: 'LOGGED',
        messageType: task?.messageType ?? input.messageType,
        body: input.body ?? null,
        status: 'SENT',
        sentAt: input.sentAt,
        sentById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        isFirstContact: lead.firstContactAt === null || lead.firstContactAt > input.sentAt,
        taskId: task?.id ?? null,
        enrollmentId: task?.enrollmentId ?? null,
        cadenceStepId: task?.cadenceStepId ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      select: messageSelect,
    });
    await recordOutboundSent(ctx, message, input.sentAt, task?.id ?? null);
    return describeMessage(message);
  },
});

/** Mensagens do lead (enviadas, pendentes e respostas), da mais recente para a mais antiga. */
export const listLeadMessages = defineUseCase({
  name: 'messaging.listForLead',
  access: 'lead.read',
  input: leadMessagesInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const messages = await ctx.tx.message.findMany({
      where: { leadId: input.leadId, status: { not: 'CANCELED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: messageSelect,
    });
    return messages.map(describeMessage);
  },
});
