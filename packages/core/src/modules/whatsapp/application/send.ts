import type { Prisma } from '@docline/db';
import { z } from 'zod';
import { WhatsappProviderError, type WhatsappOutbound } from '../../../ports/whatsapp';
import { systemActor } from '../../../shared/actor';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type UseCaseContext,
} from '../../../shared/use-case';
import { JOBS } from '../../../jobs/catalog';
import { evaluateLeadGate } from '../../compliance';
import { auditLead, requireEditableLead, requireLeadInScope } from '../../leads';
import { describeMessage, messageSelect } from '../../messaging';
import { retryWhatsappMessageInput, sendWhatsappMessageInput } from '../contracts/schemas';
import { describeWhatsappError } from '../domain/errors';
import {
  isParameterFormat,
  orderedTemplateParams,
  renderTemplate,
  validateTemplateParams,
} from '../domain/templates';
import { serviceWindow } from '../domain/window';
import { markMessageFailed, markMessageSent } from '../infra/outcome';

/**
 * Envio pela WhatsApp Cloud API (F7-01; docs/INTEGRATIONS.md §6.2):
 *
 * 1. `sendWhatsappMessage` (pessoa): gate do modo API, regra da janela (texto
 *    livre só com a janela aberta; modelo só para número com opt-in), mensagem
 *    `QUEUED` e o job, na mesma transação.
 * 2. `runWhatsappSend` (worker): marca a tentativa e confere o gate de novo
 *    (transação 1), chama a Meta fora da transação e grava o resultado
 *    (transação 2). Resultado incerto vira falha sem reenvio: o webhook de
 *    status corrige se a mensagem saiu, ou a pessoa decide.
 */

const sendSelect = {
  ...messageSelect,
  status: true,
  createdById: true,
  sendAttemptedAt: true,
  failedAt: true,
  errorCode: true,
  templateParams: true,
  conversationId: true,
  conversation: { select: { id: true, externalThreadId: true } },
  whatsappTemplate: {
    select: { id: true, name: true, language: true, parameterFormat: true, bodyParameters: true },
  },
} satisfies Prisma.MessageSelect;

type SendRow = Prisma.MessageGetPayload<{ select: typeof sendSelect }>;

/** Número do contato no formato da API (E.164 sem o "+"). */
const apiNumber = (e164: string) => e164.replace(/^\+/, '');

/** Conversa do número (cria na primeira mensagem). */
async function conversationFor(
  ctx: UseCaseContext,
  leadId: string,
  point: { id: string; valueNormalized: string },
) {
  const existing = await ctx.tx.conversation.findFirst({
    where: { leadId, channel: 'WHATSAPP', contactPointId: point.id },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  const externalThreadId = apiNumber(point.valueNormalized);
  return ctx.tx.conversation.upsert({
    where: {
      leadId_channel_externalThreadId: { leadId, channel: 'WHATSAPP', externalThreadId },
    },
    create: { leadId, channel: 'WHATSAPP', contactPointId: point.id, externalThreadId },
    update: { contactPointId: point.id },
  });
}

export const sendWhatsappMessage = defineUseCase({
  name: 'whatsapp.send',
  access: 'lead.update',
  input: sendWhatsappMessageInput,
  async run(ctx, input) {
    const provider = ctx.deps.whatsapp;
    if (!provider) {
      throw new BusinessRuleError(
        'O envio pela API do WhatsApp não está ativo. Use o contato assistido.',
      );
    }
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const idempotencyKey = input.clientRequestId
      ? `whatsapp:${actorId ?? 'system'}:${input.clientRequestId}`
      : null;
    if (idempotencyKey) {
      const repeated = await ctx.tx.message.findUnique({
        where: { idempotencyKey },
        select: messageSelect,
      });
      if (repeated) {
        if (repeated.leadId !== input.leadId)
          throw new ConflictError('Pedido repetido com outro lead.');
        return describeMessage(repeated);
      }
    }

    const lead = await requireEditableLead(ctx, input.leadId, { id: true, firstContactAt: true });
    const gate = await evaluateLeadGate(ctx.tx, lead.id, {
      mode: 'API',
      actor: ctx.actor,
      now: ctx.now,
    });
    const whatsapp = gate.channels.find((c) => c.channel === 'WHATSAPP')!;
    if (!whatsapp.allowed) throw new BusinessRuleError(whatsapp.reasons.join(' '));

    const points = await ctx.tx.contactPoint.findMany({
      where: { id: { in: whatsapp.usableContactPointIds } },
      select: {
        id: true,
        valueNormalized: true,
        permissions: {
          where: { channel: 'WHATSAPP', optInStatus: 'GRANTED' },
          select: { id: true },
        },
        conversations: {
          where: { channel: 'WHATSAPP' },
          select: { serviceWindowExpiresAt: true },
        },
      },
    });
    const windowOpen = (p: (typeof points)[number]) =>
      p.conversations.some((c) => serviceWindow(c.serviceWindowExpiresAt, ctx.now).open);
    const fits = (p: (typeof points)[number]) =>
      input.kind === 'text' ? windowOpen(p) : p.permissions.length > 0;
    const point = input.contactPointId
      ? points.find((p) => p.id === input.contactPointId)
      : (points.find(fits) ?? points[0]);
    if (!point)
      throw new BusinessRuleError('Este número não pode receber mensagens pela API agora.');
    if (!fits(point)) {
      throw new BusinessRuleError(
        input.kind === 'text'
          ? 'Texto livre só dentro de 24 h da última mensagem do contato. Envie um modelo aprovado.'
          : 'Este número não tem opt-in do WhatsApp. Sem opt-in, só dá para responder em até 24 h da última mensagem do contato.',
      );
    }

    // Conteúdo: texto (ou rascunho aprovado da IA) ou modelo aprovado.
    let body: string;
    let template: { id: string; approachId: string | null } | null = null;
    let templateParams: { name: string; value: string }[] | null = null;
    let generation: {
      id: string;
      kind: string;
      approachId: string | null;
      approvedById: string | null;
      approvedAt: Date | null;
    } | null = null;
    if (input.kind === 'text') {
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
    } else {
      const row = await ctx.tx.whatsappTemplate.findUnique({ where: { id: input.templateId } });
      if (!row || row.removedAt || !row.active || row.status !== 'APPROVED' || !row.supported) {
        throw new BusinessRuleError('Este modelo não está aprovado ou não está liberado para uso.');
      }
      const issues = validateTemplateParams(row.bodyParameters, input.params);
      if (issues.length > 0) {
        throw new ValidationError(
          issues.map((i) => ({ path: `params.${i.parameter}`, message: i.message })),
        );
      }
      templateParams = orderedTemplateParams(row.bodyParameters, input.params);
      body = renderTemplate(
        row.bodyText,
        Object.fromEntries(templateParams.map((p) => [p.name, p.value])),
      );
      template = { id: row.id, approachId: row.approachId };
    }

    // Sem tarefa informada, o envio cumpre o passo da cadência que já venceu (se houver).
    const task = await ctx.tx.task.findFirst({
      where: input.taskId
        ? { id: input.taskId, leadId: lead.id, status: 'OPEN' }
        : { leadId: lead.id, status: 'OPEN', enrollmentId: { not: null }, dueAt: { lte: ctx.now } },
      select: { id: true, messageType: true, enrollmentId: true, cadenceStepId: true },
    });
    if (input.taskId && !task) throw new NotFoundError('Tarefa aberta não encontrada neste lead.');

    const conversation = await conversationFor(ctx, lead.id, point);
    const message = await ctx.tx.message.create({
      data: {
        leadId: lead.id,
        contactPointId: point.id,
        conversationId: conversation.id,
        channel: 'WHATSAPP',
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
        whatsappTemplateId: template?.id ?? null,
        templateParams: templateParams ? toJson(templateParams) : undefined,
        aiGenerationId: generation?.id ?? null,
        approachId: generation?.approachId ?? template?.approachId ?? null,
        approvedById: generation?.approvedById ?? null,
        approvedAt: generation?.approvedAt ?? null,
        taskId: task?.id ?? null,
        enrollmentId: task?.enrollmentId ?? null,
        cadenceStepId: task?.cadenceStepId ?? null,
        sentById: actorId,
        createdById: actorId,
        idempotencyKey,
      },
      select: messageSelect,
    });
    await ctx.deps.jobs.enqueue(
      JOBS.whatsappSend.name,
      { messageId: message.id },
      { tx: ctx.tx, singletonKey: message.id },
    );
    await auditLead(ctx, lead.id, 'whatsapp.send', {
      subjectId: message.id,
      metadata: { kind: input.kind, ...(template ? { templateId: template.id } : {}) },
    });
    return describeMessage(message);
  },
});

/**
 * Tentar de novo uma mensagem que falhou. Falha conhecida volta para a fila;
 * resultado incerto só depois de 10 minutos sem status da Meta e com a pessoa
 * assumindo o risco de o contato receber duas vezes.
 */
export const retryWhatsappMessage = defineUseCase({
  name: 'whatsapp.retry',
  access: 'lead.update',
  input: retryWhatsappMessageInput,
  async run(ctx, input) {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: sendSelect,
    });
    if (!message || message.mode !== 'API' || message.direction !== 'OUTBOUND') {
      throw new NotFoundError('Mensagem não encontrada.');
    }
    await requireEditableLead(ctx, message.leadId, { id: true });
    if (message.status !== 'FAILED')
      throw new BusinessRuleError('Só mensagens que falharam podem ser reenviadas.');
    const { kind } = describeWhatsappError(message.errorCode ?? '');
    if (kind === 'MARKETING_OPT_OUT') {
      throw new BusinessRuleError('O contato pediu para não receber marketing: não reenvie.');
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
      JOBS.whatsappSend.name,
      { messageId: message.id },
      { tx: ctx.tx, singletonKey: `${message.id}:${ctx.now.getTime()}` },
    );
    await auditLead(ctx, message.leadId, 'whatsapp.retry', {
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

/** Transação 1: confere tudo de novo e marca a tentativa (só uma por mensagem). */
const claimSend = defineUseCase({
  name: 'whatsapp.send.claim',
  access: 'lead.update',
  input: jobInput,
  async run(ctx, input): Promise<WhatsappOutbound | null> {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: sendSelect,
    });
    if (!message || message.mode !== 'API' || message.status !== 'QUEUED') return null;
    if (message.sendAttemptedAt) {
      // Uma tentativa anterior caiu no meio: não se sabe se saiu.
      await markMessageFailed(ctx, message.id, {
        code: 'CONNECTION_LOST',
        failedAt: ctx.now,
        from: ['QUEUED'],
      });
      return null;
    }
    const gate = await evaluateLeadGate(ctx.tx, message.leadId, {
      mode: 'API',
      actor: ctx.actor,
      now: ctx.now,
    });
    const whatsapp = gate.channels.find((c) => c.channel === 'WHATSAPP')!;
    const point = message.contactPoint;
    if (!whatsapp.allowed || !point || !whatsapp.usableContactPointIds.includes(point.id)) {
      await markMessageFailed(ctx, message.id, {
        code: 'GATE_BLOCKED',
        detail:
          whatsapp.reasons.join(' ') || 'Este número não pode mais receber mensagens pela API.',
        failedAt: ctx.now,
        from: ['QUEUED'],
      });
      return null;
    }
    const claimed = await ctx.tx.message.updateMany({
      where: { id: message.id, status: 'QUEUED', sendAttemptedAt: null },
      data: { sendAttemptedAt: ctx.now },
    });
    if (claimed.count === 0) return null;

    const contact = await ctx.tx.contactPoint.findUniqueOrThrow({
      where: { id: point.id },
      select: { valueNormalized: true },
    });
    const to = message.conversation?.externalThreadId ?? apiNumber(contact.valueNormalized);
    const template = message.whatsappTemplate;
    if (template) {
      const params = (message.templateParams ?? []) as { name: string; value: string }[];
      return {
        kind: 'template',
        to,
        reference: message.id,
        template: {
          name: template.name,
          language: template.language,
          parameterFormat: isParameterFormat(template.parameterFormat)
            ? template.parameterFormat
            : 'POSITIONAL',
          bodyParameters: params,
        },
      };
    }
    return { kind: 'text', to, reference: message.id, body: message.body ?? '' };
  },
});

/** Transação 2: a Meta aceitou (se o webhook de status chegou antes, nada se repete). */
const finishSend = defineUseCase({
  name: 'whatsapp.send.finish',
  access: 'lead.update',
  input: jobInput.extend({ providerMessageId: z.string().min(1), waId: z.string().nullable() }),
  async run(ctx, input) {
    await markMessageSent(ctx, input.messageId, {
      providerMessageId: input.providerMessageId,
      sentAt: ctx.now,
      waId: input.waId,
    });
  },
});

/** Transação 2: a Meta recusou (ou não se sabe). */
const failSend = defineUseCase({
  name: 'whatsapp.send.fail',
  access: 'lead.update',
  input: jobInput.extend({ code: z.string().min(1), outcome: z.enum(['NOT_SENT', 'UNKNOWN']) }),
  async run(ctx, input) {
    // Resultado incerto fica com um código de "não se sabe" (bloqueia o reenvio imediato).
    const code =
      input.outcome === 'UNKNOWN' && describeWhatsappError(input.code).kind !== 'UNKNOWN_OUTCOME'
        ? 'CONNECTION_LOST'
        : input.code;
    const detail =
      code !== input.code
        ? `${describeWhatsappError(code).message} (código ${input.code})`
        : undefined;
    // Se um webhook de status chegou antes, a mensagem já não está na fila e nada muda.
    await markMessageFailed(ctx, input.messageId, {
      code,
      detail,
      failedAt: ctx.now,
      from: ['QUEUED'],
    });
  },
});

/** Job `whatsapp.send`: um envio, sem nova tentativa automática. */
export async function runWhatsappSend(deps: CoreDeps, data: unknown) {
  const input = jobInput.parse(data);
  const provider = deps.whatsapp;
  const actor = systemActor('whatsapp.send');
  if (!provider) {
    // A API foi desligada com mensagens na fila: ficam como falha conhecida.
    await failSend(deps, actor, { ...input, code: 'REAL_SENDS_DISABLED', outcome: 'NOT_SENT' });
    return { status: 'disabled' as const };
  }
  const outbound = await claimSend(deps, actor, input);
  if (!outbound) return { status: 'skipped' as const };
  try {
    const result = await provider.send(outbound);
    await finishSend(deps, actor, { ...input, ...result });
    return { status: 'sent' as const };
  } catch (error) {
    if (!(error instanceof WhatsappProviderError)) {
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

/** Mensagem enviada pela API, para a tela (lead no escopo). */
export async function requireApiMessage(ctx: UseCaseContext, messageId: string): Promise<SendRow> {
  const message = await ctx.tx.message.findUnique({ where: { id: messageId }, select: sendSelect });
  if (!message) throw new NotFoundError('Mensagem não encontrada.');
  await requireLeadInScope(ctx, message.leadId, { id: true });
  return message;
}
