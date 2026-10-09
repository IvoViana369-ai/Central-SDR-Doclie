import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { InstagramProviderError } from '../../../ports/instagram';
import { systemActor } from '../../../shared/actor';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, type CoreDeps, type UseCaseContext } from '../../../shared/use-case';
import { JOBS } from '../../../jobs/catalog';
import { evaluateLeadGate } from '../../compliance';
import { auditLead, requireEditableLead } from '../../leads';
import { describeMessage, messageSelect } from '../../messaging';
import {
  INSTAGRAM_MAX_TEXT_BYTES,
  retryInstagramMessageInput,
  sendInstagramMessageInput,
  sendInstagramPrivateReplyInput,
} from '../contracts/schemas';
import { describeInstagramError } from '../domain/errors';
import { messagingWindow, privateReplyState } from '../domain/window';
import { markInstagramFailed, markInstagramSent } from '../infra/outcome';

/**
 * Envio pelo Instagram (F8-03; docs/INTEGRATIONS.md §7.2), no mesmo desenho do
 * WhatsApp (ADR 022):
 *
 * 1. a pessoa pede o envio: gate do modo API (ou do contato, na resposta
 *    privada), mensagem `QUEUED` e o job, na mesma transação;
 * 2. `runInstagramSend` (worker): confere tudo de novo e marca a tentativa,
 *    chama a Meta fora da transação e grava o desfecho. Resultado incerto vira
 *    falha sem reenvio: o eco no webhook corrige se a mensagem saiu.
 *
 * Só dá para responder: texto a quem escreveu nas últimas 24 h, ou uma
 * resposta privada a um comentário de até 7 dias. Iniciar conversa, nunca.
 */

function providerOf(ctx: UseCaseContext) {
  if (!ctx.deps.instagram) {
    throw new BusinessRuleError(
      'O Instagram pela API não está ativo. Use o contato assistido (copiar e abrir o perfil).',
    );
  }
  return ctx.deps.instagram;
}

async function repeatedRequest(
  ctx: UseCaseContext,
  clientRequestId: string | null | undefined,
  leadId: string | null,
) {
  if (!clientRequestId) return { key: null, message: null };
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : 'system';
  const key = `instagram:${actorId}:${clientRequestId}`;
  const message = await ctx.tx.message.findUnique({
    where: { idempotencyKey: key },
    select: messageSelect,
  });
  if (message && leadId && message.leadId !== leadId) {
    throw new ConflictError('Pedido repetido com outro lead.');
  }
  return { key, message };
}

const tooLong = (text: string) => new TextEncoder().encode(text).length > INSTAGRAM_MAX_TEXT_BYTES;

export const sendInstagramMessage = defineUseCase({
  name: 'instagram.send',
  access: 'lead.update',
  input: sendInstagramMessageInput,
  async run(ctx, input) {
    const provider = providerOf(ctx);
    const repeated = await repeatedRequest(ctx, input.clientRequestId, input.leadId);
    if (repeated.message) return describeMessage(repeated.message);

    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const gate = await evaluateLeadGate(ctx.tx, lead.id, {
      mode: 'API',
      actor: ctx.actor,
      now: ctx.now,
    });
    const instagram = gate.channels.find((c) => c.channel === 'INSTAGRAM')!;
    if (!instagram.allowed) throw new BusinessRuleError(instagram.reasons.join(' '));

    const conversation = await ctx.tx.conversation.findFirst({
      where: {
        leadId: lead.id,
        channel: 'INSTAGRAM',
        contactPointId: { in: instagram.usableContactPointIds },
        serviceWindowExpiresAt: { gt: ctx.now },
      },
      orderBy: { lastInboundAt: 'desc' },
      select: { id: true, contactPointId: true },
    });
    if (!conversation) {
      throw new BusinessRuleError(
        'Só dá para responder pelo Instagram em até 24 h da última mensagem do contato.',
      );
    }

    let body: string;
    let generation: {
      id: string;
      kind: string;
      approachId: string | null;
      approvedById: string | null;
      approvedAt: Date | null;
    } | null = null;
    if (input.aiGenerationId) {
      const draft = await ctx.tx.aiGeneration.findFirst({
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
      });
      if (draft?.status !== 'APPROVED' || !draft.textFinal) {
        throw new BusinessRuleError('O rascunho da IA precisa estar aprovado para ser enviado.');
      }
      const active = await ctx.tx.message.count({
        where: { aiGenerationId: draft.id, status: { not: 'CANCELED' } },
      });
      if (active > 0)
        throw new BusinessRuleError('Este rascunho já tem um envio feito ou em andamento.');
      generation = draft;
      body = draft.textFinal;
    } else {
      body = input.body!;
    }
    if (tooLong(body)) {
      throw new BusinessRuleError(
        'Mensagem longa demais para o Instagram (até 1.000 bytes, cerca de 1.000 letras).',
      );
    }

    // Sem tarefa informada, o envio cumpre o passo da cadência que já venceu (se houver).
    const task = await ctx.tx.task.findFirst({
      where: input.taskId
        ? { id: input.taskId, leadId: lead.id, status: 'OPEN' }
        : { leadId: lead.id, status: 'OPEN', enrollmentId: { not: null }, dueAt: { lte: ctx.now } },
      select: { id: true, messageType: true, enrollmentId: true, cadenceStepId: true },
    });
    if (input.taskId && !task) throw new NotFoundError('Tarefa aberta não encontrada neste lead.');

    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const message = await ctx.tx.message.create({
      data: {
        leadId: lead.id,
        contactPointId: conversation.contactPointId,
        conversationId: conversation.id,
        channel: 'INSTAGRAM',
        direction: 'OUTBOUND',
        mode: 'API',
        messageType:
          task?.messageType ??
          (generation && generation.kind !== 'REPLY_CLASSIFICATION'
            ? (generation.kind as Prisma.MessageCreateInput['messageType'])
            : null) ??
          input.messageType,
        body,
        status: 'QUEUED',
        provider: provider.name,
        aiGenerationId: generation?.id ?? null,
        approachId: generation?.approachId ?? null,
        approvedById: generation?.approvedById ?? null,
        approvedAt: generation?.approvedAt ?? null,
        taskId: task?.id ?? null,
        enrollmentId: task?.enrollmentId ?? null,
        cadenceStepId: task?.cadenceStepId ?? null,
        sentById: actorId,
        createdById: actorId,
        idempotencyKey: repeated.key,
      },
      select: messageSelect,
    });
    await ctx.deps.jobs.enqueue(
      JOBS.instagramSend.name,
      { messageId: message.id },
      { tx: ctx.tx, singletonKey: message.id },
    );
    await auditLead(ctx, lead.id, 'instagram.send', { subjectId: message.id });
    return describeMessage(message);
  },
});

/**
 * Resposta privada a um comentário do lead numa publicação da Docline: a Meta
 * aceita uma por comentário, até 7 dias depois dele, e entrega na caixa de
 * mensagens (ou de solicitações, se a pessoa não segue a Docline).
 */
export const sendInstagramPrivateReply = defineUseCase({
  name: 'instagram.private_reply',
  access: 'lead.update',
  input: sendInstagramPrivateReplyInput,
  async run(ctx, input) {
    const provider = providerOf(ctx);
    const comment = await ctx.tx.socialComment.findUnique({
      where: { id: input.commentId },
      select: {
        id: true,
        leadId: true,
        contactPointId: true,
        commentedAt: true,
        privateReplyMessageId: true,
      },
    });
    if (!comment) throw new NotFoundError('Comentário não encontrado.');
    const repeated = await repeatedRequest(ctx, input.clientRequestId, comment.leadId);
    if (repeated.message) return describeMessage(repeated.message);

    await requireEditableLead(ctx, comment.leadId, { id: true });
    const state = privateReplyState(comment, ctx.now);
    if (state === 'sent') {
      throw new BusinessRuleError(
        'Este comentário já tem uma resposta privada (a Meta aceita só uma). Se ela falhou, use "Tentar de novo".',
      );
    }
    if (state === 'expired') {
      throw new BusinessRuleError(
        'Passaram 7 dias desde o comentário: a Meta não aceita mais a resposta privada.',
      );
    }
    // Mesmas regras do contato: Lista Não Contatar, base legal, horário e intervalo.
    const gate = await evaluateLeadGate(ctx.tx, comment.leadId, {
      mode: 'ASSISTED',
      actor: ctx.actor,
      now: ctx.now,
    });
    const instagram = gate.channels.find((c) => c.channel === 'INSTAGRAM')!;
    if (!instagram.allowed) throw new BusinessRuleError(instagram.reasons.join(' '));

    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const message = await ctx.tx.message.create({
      data: {
        leadId: comment.leadId,
        contactPointId: comment.contactPointId,
        channel: 'INSTAGRAM',
        direction: 'OUTBOUND',
        mode: 'API',
        messageType: 'OTHER',
        body: input.body,
        status: 'QUEUED',
        provider: provider.name,
        sentById: actorId,
        createdById: actorId,
        idempotencyKey: repeated.key,
      },
      select: messageSelect,
    });
    // Única por comentário também no banco (índice único na coluna).
    await ctx.tx.socialComment.update({
      where: { id: comment.id },
      data: { privateReplyMessageId: message.id },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.instagramSend.name,
      { messageId: message.id },
      { tx: ctx.tx, singletonKey: message.id },
    );
    await auditLead(ctx, comment.leadId, 'instagram.private_reply', {
      subjectId: message.id,
      metadata: { commentId: comment.id },
    });
    return describeMessage(message);
  },
});

const sendSelect = {
  id: true,
  leadId: true,
  mode: true,
  channel: true,
  status: true,
  body: true,
  contactPointId: true,
  sendAttemptedAt: true,
  failedAt: true,
  errorCode: true,
  conversation: { select: { externalThreadId: true, serviceWindowExpiresAt: true } },
  privateReplyFor: { select: { externalCommentId: true, commentedAt: true } },
} satisfies Prisma.MessageSelect;

/**
 * Tentar de novo uma mensagem que falhou. Falha conhecida volta para a fila;
 * resultado incerto só depois de 10 minutos sem eco da Meta e com a pessoa
 * assumindo o risco de o contato receber duas vezes.
 */
export const retryInstagramMessage = defineUseCase({
  name: 'instagram.retry',
  access: 'lead.update',
  input: retryInstagramMessageInput,
  async run(ctx, input) {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: sendSelect,
    });
    if (!message || message.mode !== 'API' || message.channel !== 'INSTAGRAM') {
      throw new NotFoundError('Mensagem não encontrada.');
    }
    await requireEditableLead(ctx, message.leadId, { id: true });
    if (message.status !== 'FAILED')
      throw new BusinessRuleError('Só mensagens que falharam podem ser reenviadas.');
    const { kind } = describeInstagramError(message.errorCode ?? '');
    if (kind === 'REPLY_NOT_ALLOWED' || kind === 'SENDS_DISABLED') {
      throw new BusinessRuleError(describeInstagramError(message.errorCode ?? '').message);
    }
    // Prazo da Meta vencido: voltar para a fila só geraria outra falha.
    const reply = message.privateReplyFor;
    if (reply) {
      if (privateReplyState({ ...reply, privateReplyMessageId: null }, ctx.now) === 'expired') {
        throw new BusinessRuleError(
          'Passaram 7 dias desde o comentário: a Meta não aceita mais a resposta privada.',
        );
      }
    } else if (
      !message.conversation ||
      !messagingWindow(message.conversation.serviceWindowExpiresAt, ctx.now).open
    ) {
      throw new BusinessRuleError(
        'A janela de 24 h fechou: dá para responder pela API quando o contato escrever de novo.',
      );
    }
    if (kind === 'UNKNOWN_OUTCOME') {
      const waited =
        message.failedAt && ctx.now.getTime() - message.failedAt.getTime() >= 10 * 60_000;
      if (!waited) {
        throw new BusinessRuleError(
          'Aguarde 10 minutos: se a mensagem saiu, a Meta avisa e o status é corrigido sozinho.',
        );
      }
      if (!input.confirmDuplicateRisk) {
        throw new BusinessRuleError(
          'Não dá para saber se a mensagem saiu. Confirme que aceita o risco de o contato receber duas vezes.',
        );
      }
    }
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        status: 'QUEUED',
        sendAttemptedAt: null,
        failedAt: null,
        errorCode: null,
        errorDetail: null,
      },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.instagramSend.name,
      { messageId: message.id },
      { tx: ctx.tx, singletonKey: `${message.id}:${ctx.now.getTime()}` },
    );
    await auditLead(ctx, message.leadId, 'instagram.retry', {
      subjectId: message.id,
      metadata: {
        previousError: message.errorCode,
        confirmDuplicateRisk: input.confirmDuplicateRisk,
      },
    });
    return describeMessage(
      await ctx.tx.message.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect }),
    );
  },
});

// --- Job ---------------------------------------------------------------------

const jobInput = z.object({ messageId: z.uuid() });

type Outbound =
  | { kind: 'text'; recipientId: string; text: string }
  | { kind: 'private_reply'; commentId: string; text: string };

/** Transação 1: confere tudo de novo e marca a tentativa (só uma por mensagem). */
const claimSend = defineUseCase({
  name: 'instagram.send.claim',
  access: 'lead.update',
  input: jobInput,
  async run(ctx, input): Promise<Outbound | null> {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: sendSelect,
    });
    if (!message || message.mode !== 'API' || message.status !== 'QUEUED') return null;
    const fail = (code: string, detail?: string) =>
      markInstagramFailed(ctx, message.id, { code, detail, failedAt: ctx.now }).then(() => null);
    if (message.sendAttemptedAt) {
      // Uma tentativa anterior caiu no meio: não se sabe se saiu.
      return fail('CONNECTION_LOST');
    }
    // Prazos da Meta primeiro (o código diz exatamente o que venceu); depois o gate.
    const reply = message.privateReplyFor;
    if (reply) {
      if (privateReplyState({ ...reply, privateReplyMessageId: null }, ctx.now) === 'expired') {
        return fail('10903');
      }
    } else if (
      !message.conversation ||
      !messagingWindow(message.conversation.serviceWindowExpiresAt, ctx.now).open
    ) {
      return fail('10/2018278');
    }
    const gate = await evaluateLeadGate(ctx.tx, message.leadId, {
      mode: reply ? 'ASSISTED' : 'API',
      actor: ctx.actor,
      now: ctx.now,
    });
    const instagram = gate.channels.find((c) => c.channel === 'INSTAGRAM')!;
    const usable =
      instagram.allowed &&
      (!message.contactPointId || instagram.usableContactPointIds.includes(message.contactPointId));
    if (!usable) {
      return fail(
        'GATE_BLOCKED',
        instagram.reasons.join(' ') || 'Este contato não pode mais receber mensagens pela API.',
      );
    }
    const claimed = await ctx.tx.message.updateMany({
      where: { id: message.id, status: 'QUEUED', sendAttemptedAt: null },
      data: { sendAttemptedAt: ctx.now },
    });
    if (claimed.count === 0) return null;
    return reply
      ? { kind: 'private_reply', commentId: reply.externalCommentId, text: message.body ?? '' }
      : {
          kind: 'text',
          recipientId: message.conversation!.externalThreadId,
          text: message.body ?? '',
        };
  },
});

/** Transação 2: a Meta aceitou (se o eco chegou antes, nada se repete). */
const finishSend = defineUseCase({
  name: 'instagram.send.finish',
  access: 'lead.update',
  input: jobInput.extend({
    providerMessageId: z.string().min(1),
    recipientId: z.string().nullable(),
  }),
  async run(ctx, input) {
    await markInstagramSent(ctx, input.messageId, {
      providerMessageId: input.providerMessageId,
      sentAt: ctx.now,
      recipientId: input.recipientId,
    });
  },
});

/** Transação 2: a Meta recusou (ou não se sabe). */
const failSend = defineUseCase({
  name: 'instagram.send.fail',
  access: 'lead.update',
  input: jobInput.extend({ code: z.string().min(1), outcome: z.enum(['NOT_SENT', 'UNKNOWN']) }),
  async run(ctx, input) {
    // Resultado incerto fica com um código de "não se sabe" (bloqueia o reenvio imediato).
    const code =
      input.outcome === 'UNKNOWN' && describeInstagramError(input.code).kind !== 'UNKNOWN_OUTCOME'
        ? 'CONNECTION_LOST'
        : input.code;
    const detail =
      code !== input.code
        ? `${describeInstagramError(code).message} (código ${input.code})`
        : undefined;
    await markInstagramFailed(ctx, input.messageId, { code, detail, failedAt: ctx.now });
  },
});

/** Job `instagram.send`: um envio, sem nova tentativa automática. */
export async function runInstagramSend(deps: CoreDeps, data: unknown) {
  const input = jobInput.parse(data);
  const provider = deps.instagram;
  const actor = systemActor('instagram.send');
  if (!provider) {
    // A API foi desligada com mensagens na fila: ficam como falha conhecida.
    await failSend(deps, actor, { ...input, code: 'REAL_SENDS_DISABLED', outcome: 'NOT_SENT' });
    return { status: 'disabled' as const };
  }
  const outbound = await claimSend(deps, actor, input);
  if (!outbound) return { status: 'skipped' as const };
  try {
    const result =
      outbound.kind === 'text'
        ? await provider.sendText({ recipientId: outbound.recipientId, text: outbound.text })
        : await provider.sendPrivateReply({ commentId: outbound.commentId, text: outbound.text });
    await finishSend(deps, actor, { ...input, ...result });
    return { status: 'sent' as const };
  } catch (error) {
    if (!(error instanceof InstagramProviderError)) {
      // Erro do nosso lado depois de chamar a Meta: não se sabe se saiu.
      await failSend(deps, actor, { ...input, code: 'CONNECTION_LOST', outcome: 'UNKNOWN' });
      throw error;
    }
    await failSend(deps, actor, {
      ...input,
      code: error.details.code,
      outcome: error.details.outcome,
    });
    return { status: 'failed' as const, code: error.details.code };
  }
}
