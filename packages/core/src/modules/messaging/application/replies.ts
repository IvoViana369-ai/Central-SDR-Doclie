import type { ReplyClassification, TaskType } from '@docline/db';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { nextWindowOpening } from '../../../shared/calendar';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { refreshLeadContactState } from '../../compliance';
import {
  engagementActorOf,
  findOngoingEnrollment,
  pauseLeadEnrollment,
  PRE_REPLY_STAGE_KEYS,
  recordInboundContact,
  stopLeadEnrollment,
} from '../../engagement';
import {
  applyLeadOptOut,
  auditLead,
  LEAD_EVENTS,
  requireEditableLead,
  requireLeadForOptOut,
  requireLeadInScope,
} from '../../leads';
import { moveLeadToStageKey } from '../../pipeline';
import { recomputeLeadScores } from '../../scoring';
import { loadContactRules, loadLeadCalendar } from '../../settings';
import { closeReplyTasks, createTaskRecord } from '../../tasks';
import { classifyReplyInput, recordReplyInput } from '../contracts/schemas';
import { REPLY_CLASSIFICATION_LABELS } from '../domain/labels';
import { detectOptOut, type OptOutDetection } from '../domain/opt-out';
import { describeMessage, messageSelect } from './outbound';

const DAY_MS = 86_400_000;
const DEFAULT_OUT_OF_OFFICE_DAYS = 7;

/** Cria a tarefa se o lead ainda não tem uma aberta do mesmo tipo. */
async function ensureTask(
  ctx: UseCaseContext,
  lead: { id: string; ownerId: string | null },
  type: TaskType,
  title: string,
  dueAt: Date,
) {
  const open = await ctx.tx.task.count({ where: { leadId: lead.id, type, status: 'OPEN' } });
  if (open > 0) return;
  await createTaskRecord(ctx, {
    leadId: lead.id,
    type,
    title,
    dueAt,
    assigneeId: lead.ownerId ?? (ctx.actor.kind === 'user' ? ctx.actor.id : null),
  });
}

/**
 * Ações de cada classificação (docs/SDR-FLOW.md §7). Etapas só avançam (um
 * lead em reunião não volta para "Respondeu"); opt-out vale na hora.
 */
async function applyClassification(
  ctx: UseCaseContext,
  lead: {
    id: string;
    ownerId: string | null;
    municipalityCode: number | null;
    stateUf: string | null;
  },
  message: { id: string; contactPointId: string | null; optOutMatch: string | null },
  classification: ReplyClassification,
  outOfOfficeUntil: Date | null,
) {
  const label = REPLY_CLASSIFICATION_LABELS[classification];
  switch (classification) {
    case 'INTERESTED':
      await moveLeadToStageKey(ctx, lead.id, 'INTERESTED', {
        source: 'INBOUND',
        onlyFrom: [...PRE_REPLY_STAGE_KEYS, 'REPLIED'],
      });
      await closeReplyTasks(ctx, lead.id, label);
      await ensureTask(ctx, lead, 'MEETING', 'Propor reunião', ctx.now);
      return;
    case 'QUESTION':
    case 'OBJECTION':
    case 'OTHER':
      await ensureTask(
        ctx,
        lead,
        'REPLY_NEEDED',
        classification === 'QUESTION'
          ? 'Responder dúvida'
          : classification === 'OBJECTION'
            ? 'Responder objeção'
            : 'Responder',
        ctx.now,
      );
      return;
    case 'NOT_INTERESTED':
      await closeReplyTasks(ctx, lead.id, label);
      await moveLeadToStageKey(ctx, lead.id, 'NOT_INTERESTED', {
        source: 'INBOUND',
        unlessClosed: true,
        lossReasonKey: 'NO_INTEREST',
      });
      return;
    case 'OPT_OUT': {
      // Lista Não Contatar na hora: encerra a cadência e cancela as abordagens.
      const full = await requireLeadForOptOut(ctx, lead.id);
      await applyLeadOptOut(ctx, full, {
        scope: 'ALL_CHANNELS',
        reason: 'OPT_OUT',
        notes: message.optOutMatch
          ? `Resposta com "${message.optOutMatch}".`
          : 'Resposta classificada como opt-out.',
      });
      await closeReplyTasks(ctx, lead.id, label);
      await moveLeadToStageKey(ctx, lead.id, 'NOT_INTERESTED', {
        source: 'INBOUND',
        unlessClosed: true,
        lossReasonKey: 'ASKED_NOT_TO_BE_CONTACTED',
      });
      return;
    }
    case 'OUT_OF_OFFICE': {
      const until =
        outOfOfficeUntil ?? new Date(ctx.now.getTime() + DEFAULT_OUT_OF_OFFICE_DAYS * DAY_MS);
      await pauseLeadEnrollment(ctx.tx, lead.id, until, ctx.now, engagementActorOf(ctx.actor));
      await closeReplyTasks(ctx, lead.id, label);
      const rules = await loadContactRules(ctx.tx);
      const calendar = await loadLeadCalendar(ctx.tx, lead, ctx.now, { rules });
      await ensureTask(
        ctx,
        lead,
        'FOLLOW_UP',
        'Retomar contato',
        nextWindowOpening(until, calendar),
      );
      return;
    }
    case 'WRONG_CONTACT':
      if (message.contactPointId) {
        await ctx.tx.contactPoint.update({
          where: { id: message.contactPointId },
          data: { status: 'WRONG_PERSON', isPrimary: false },
        });
        // Sem contato válido para o próximo passo, a cadência termina.
        await refreshLeadContactState(ctx.tx, lead.id, ctx.now);
      }
      await closeReplyTasks(ctx, lead.id, label);
      await ensureTask(ctx, lead, 'CUSTOM', 'Procurar outro contato', ctx.now);
      return;
  }
}

/**
 * Resposta recebida (F5-10; MVP M13 e M14): o SDR cola o texto. Primeiro as
 * regras de opt-out (resposta certa vira opt-out na hora); depois a
 * classificação escolhida, se houver. A cadência para (ou pausa, se
 * "ausente") e o lead vai para "Respondeu".
 */
export const recordReply = defineUseCase({
  name: 'messaging.recordReply',
  access: 'lead.update',
  input: recordReplyInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, {
      id: true,
      ownerId: true,
      municipalityCode: true,
      stateUf: true,
    });
    const receivedAt = input.receivedAt ?? ctx.now;
    if (receivedAt > ctx.now) throw new BusinessRuleError('A resposta não pode estar no futuro.');
    if (input.contactPointId) {
      const cp = await ctx.tx.contactPoint.findFirst({
        where: { id: input.contactPointId, leadId: lead.id },
        select: { id: true },
      });
      if (!cp) throw new NotFoundError('Contato não encontrado neste lead.');
    }

    const rules = await loadContactRules(ctx.tx);
    const detection: OptOutDetection = detectOptOut(input.body, rules.optOutKeywords);
    // Opt-out certo prevalece sobre qualquer classificação: o titular pediu.
    const classification: ReplyClassification | null =
      detection.level === 'CERTAIN' ? 'OPT_OUT' : (input.classification ?? null);
    const source = detection.level === 'CERTAIN' ? 'RULE' : classification ? 'HUMAN' : null;

    const message = await ctx.tx.message.create({
      data: {
        leadId: lead.id,
        contactPointId: input.contactPointId ?? null,
        channel: input.channel,
        direction: 'INBOUND',
        mode: 'LOGGED',
        body: input.body,
        status: 'RECEIVED',
        receivedAt,
        optOutMatch: detection.match,
        classification,
        classificationSource: source,
        classifiedById: source === 'HUMAN' && ctx.actor.kind === 'user' ? ctx.actor.id : null,
        classifiedAt: classification ? ctx.now : null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      select: messageSelect,
    });
    await recordInboundContact(ctx.tx, lead.id, receivedAt);
    await ctx.tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: LEAD_EVENTS.messageReceived,
        occurredAt: receivedAt,
        actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
        actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        subjectType: 'message',
        subjectId: message.id,
        channel: input.channel,
        payload: toJson({ classification, optOut: detection.level }),
      },
    });

    // Cadência: "ausente" pausa; qualquer outra resposta encerra (se a cadência pedir).
    if (classification !== 'OUT_OF_OFFICE' && classification !== 'OPT_OUT') {
      const enrollment = await findOngoingEnrollment(ctx.tx, lead.id);
      if (enrollment?.cadence.stopOnReply) {
        await stopLeadEnrollment(ctx.tx, lead.id, 'REPLIED', ctx.now, engagementActorOf(ctx.actor));
      }
    }
    if (classification !== 'NOT_INTERESTED' && classification !== 'OPT_OUT') {
      await moveLeadToStageKey(ctx, lead.id, 'REPLIED', {
        source: 'INBOUND',
        onlyFrom: PRE_REPLY_STAGE_KEYS,
      });
    }

    if (classification) {
      await applyClassification(ctx, lead, message, classification, input.outOfOfficeUntil ?? null);
    } else {
      // Sem classificação: a pessoa decide. Possível opt-out aparece em destaque.
      await ensureTask(
        ctx,
        lead,
        'REPLY_NEEDED',
        detection.level === 'POSSIBLE'
          ? `Possível pedido de opt-out ("${detection.match}"): classifique antes de responder`
          : 'Classificar e responder',
        ctx.now,
      );
    }
    // "Já respondeu" e "Mostrou interesse" são critérios do score.
    await recomputeLeadScores(ctx.tx, [lead.id], 'reply', ctx.now);
    await auditLead(ctx, lead.id, 'reply.record', {
      subjectId: message.id,
      metadata: { channel: input.channel, classification, optOut: detection.level },
    });
    return {
      message: describeMessage(
        await ctx.tx.message.findUniqueOrThrow({
          where: { id: message.id },
          select: messageSelect,
        }),
      ),
      optOut: detection,
    };
  },
});

/** Classificar (ou reclassificar) uma resposta registrada. Opt-out não volta atrás aqui. */
export const classifyReply = defineUseCase({
  name: 'messaging.classifyReply',
  access: 'lead.update',
  input: classifyReplyInput,
  async run(ctx, input) {
    const message = await ctx.tx.message.findUnique({
      where: { id: input.messageId },
      select: messageSelect,
    });
    if (!message || message.direction !== 'INBOUND') {
      throw new NotFoundError('Resposta não encontrada.');
    }
    const lead = await requireLeadInScope(ctx, message.leadId, {
      id: true,
      ownerId: true,
      municipalityCode: true,
      stateUf: true,
      status: true,
    });
    if (lead.status === 'MERGED' || lead.status === 'ANONYMIZED') {
      throw new BusinessRuleError('Este lead não pode mais ser alterado.');
    }
    if (message.classification === 'OPT_OUT') {
      throw new BusinessRuleError(
        'O opt-out já foi registrado e vale para todos os canais. Revogar só pela Conformidade (ADMIN).',
      );
    }
    if (message.classification === input.classification) return describeMessage(message);
    await ctx.tx.message.update({
      where: { id: message.id },
      data: {
        classification: input.classification,
        classificationSource: 'HUMAN',
        classifiedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        classifiedAt: ctx.now,
      },
    });
    await ctx.tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: LEAD_EVENTS.replyClassified,
        occurredAt: ctx.now,
        actorType: ctx.actor.kind === 'user' ? 'USER' : 'AUTOMATION',
        actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        subjectType: 'message',
        subjectId: message.id,
        payload: toJson({ from: message.classification, to: input.classification }),
      },
    });
    await applyClassification(
      ctx,
      lead,
      message,
      input.classification,
      input.outOfOfficeUntil ?? null,
    );
    await recomputeLeadScores(ctx.tx, [lead.id], 'reply', ctx.now);
    await auditLead(ctx, lead.id, 'reply.classify', {
      subjectId: message.id,
      changes: { classification: [message.classification, input.classification] },
    });
    return describeMessage(
      await ctx.tx.message.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect }),
    );
  },
});
