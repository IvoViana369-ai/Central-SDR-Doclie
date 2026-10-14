import type { Prisma } from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { refreshLeadContactState, suppressIdentifiers } from '../../compliance';
import {
  cancelOpenTasks,
  engagementActorOf,
  refreshNextAction,
  stopLeadEnrollment,
} from '../../engagement';
import { buildLeadNames, formatLeadCode, LEAD_EVENTS, requireLeadInScope } from '../../leads';
import { maskIdentifier } from '../../normalization';
import { applyStageChange, stageRefSelect } from '../../pipeline';
import { mergeDuplicateInput } from '../contracts/schemas';
import {
  defaultMergeChoices,
  mergeCustomFields,
  mergedColumns,
  type MergeableLead,
  type MergeChoices,
} from '../domain/merge';
import { lockCandidate } from './review';

/** Todas as colunas do lead mesclado vão para a cópia em `lead_merges`. */
async function loadForMerge(ctx: UseCaseContext, leadId: string) {
  const lead = await requireLeadInScope(ctx, leadId, {
    id: true,
    code: true,
    version: true,
    status: true,
  });
  if (lead.status !== 'ACTIVE' && lead.status !== 'ARCHIVED') {
    throw new ConflictError(`O lead ${formatLeadCode(lead.code)} não pode mais ser mesclado.`);
  }
  return ctx.tx.lead.findUniqueOrThrow({ where: { id: leadId } });
}

type FullLead = Prisma.LeadGetPayload<object>;

/** Contatos do mesclado: os que o sobrevivente já tem ficam onde estão. */
async function moveContactPoints(ctx: UseCaseContext, survivor: FullLead, merged: FullLead) {
  const [mine, theirs] = await Promise.all(
    [survivor.id, merged.id].map((leadId) =>
      ctx.tx.contactPoint.findMany({
        where: { leadId },
        select: {
          id: true,
          type: true,
          valueNormalized: true,
          isPrimary: true,
          status: true,
          personId: true,
          whatsappStatus: true,
        },
      }),
    ),
  );
  const byValue = new Map(mine!.map((cp) => [`${cp.type}:${cp.valueNormalized}`, cp]));
  const primaryTypes = new Set(
    mine!.filter((cp) => cp.isPrimary && cp.status === 'ACTIVE').map((cp) => cp.type),
  );
  const moved: string[] = [];
  const kept: string[] = [];
  /** Contato do mesclado → o mesmo contato no sobrevivente. */
  const pairs = new Map<string, string>();
  for (const cp of theirs!) {
    const same = byValue.get(`${cp.type}:${cp.valueNormalized}`);
    if (!same) {
      moved.push(cp.id);
      continue;
    }
    kept.push(cp.id);
    pairs.set(cp.id, same.id);
    // O mesmo contato nos dois: o do sobrevivente fica (inclusive a situação dele,
    // mesmo removido ou inválido) e herda o que só o outro sabia. A cópia do
    // outro continua no lead mesclado.
    const data: Prisma.ContactPointUpdateInput = {};
    if (same.whatsappStatus === 'UNKNOWN' && cp.whatsappStatus !== 'UNKNOWN') {
      data.whatsappStatus = cp.whatsappStatus;
    }
    if (!same.personId && cp.personId) data.person = { connect: { id: cp.personId } };
    if (Object.keys(data).length > 0) {
      await ctx.tx.contactPoint.update({ where: { id: same.id }, data });
    }
  }
  if (moved.length > 0) {
    // Só um principal por tipo: os que chegam deixam de ser principais se já houver um.
    await ctx.tx.contactPoint.updateMany({
      where: { id: { in: moved }, type: { in: [...primaryTypes] } },
      data: { isPrimary: false },
    });
    await ctx.tx.contactPoint.updateMany({
      where: { id: { in: moved } },
      data: { leadId: survivor.id },
    });
  }
  return { moved, kept, pairs };
}

/**
 * Base legal e opt-in por canal do lead: o canal que o sobrevivente não tem
 * passa para ele; se os dois têm, fica o do sobrevivente, mas um opt-in
 * revogado no mesclado vale para o sobrevivente (o mais restritivo prevalece).
 * Permissões de pessoas e contatos acompanham a pessoa ou o contato. Opt-in
 * de um número que os dois têm (Fase 7): revogado em qualquer um prevalece; o
 * do mesclado passa para o número do sobrevivente que não tem registro.
 */
async function movePermissions(
  ctx: UseCaseContext,
  survivorId: string,
  mergedId: string,
  movedContactPoints: string[],
  pairs: Map<string, string>,
) {
  const theirs = await ctx.tx.contactPermission.findMany({ where: { leadId: mergedId } });
  const mine = await ctx.tx.contactPermission.findMany({
    where: { leadId: survivorId, personId: null, contactPointId: null },
  });
  const myChannels = new Map(mine.map((p) => [p.channel, p]));
  const moved: string[] = [];
  const kept: string[] = [];
  const revoked: string[] = [];
  for (const permission of theirs) {
    const leadLevel = !permission.personId && !permission.contactPointId;
    const followsContact =
      permission.contactPointId !== null && movedContactPoints.includes(permission.contactPointId);
    const followsPerson = permission.personId !== null && permission.contactPointId === null;
    if (followsContact || followsPerson || (leadLevel && !myChannels.has(permission.channel))) {
      moved.push(permission.id);
      continue;
    }
    kept.push(permission.id);
    const pairedPoint = permission.contactPointId
      ? pairs.get(permission.contactPointId)
      : undefined;
    if (pairedPoint) {
      const mineForNumber = await ctx.tx.contactPermission.findFirst({
        where: { contactPointId: pairedPoint, channel: permission.channel },
      });
      if (!mineForNumber) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = permission;
        await ctx.tx.contactPermission.create({
          data: { ...data, leadId: survivorId, contactPointId: pairedPoint },
        });
      } else if (permission.optInStatus === 'REVOKED' && mineForNumber.optInStatus === 'GRANTED') {
        await ctx.tx.contactPermission.update({
          where: { id: mineForNumber.id },
          data: { optInStatus: 'REVOKED', recordedAt: ctx.now },
        });
        revoked.push(permission.channel);
      }
      continue;
    }
    const same = leadLevel ? myChannels.get(permission.channel) : undefined;
    if (same && permission.optInStatus === 'REVOKED' && same.optInStatus !== 'REVOKED') {
      await ctx.tx.contactPermission.update({
        where: { id: same.id },
        data: { optInStatus: 'REVOKED', optInAt: null, optInMethod: null },
      });
      revoked.push(permission.channel);
    }
  }
  if (moved.length > 0) {
    await ctx.tx.contactPermission.updateMany({
      where: { id: { in: moved } },
      data: { leadId: survivorId },
    });
  }
  return { moved, kept, revoked };
}

/**
 * Conversas do WhatsApp (Fase 7) e do Instagram (Fase 8): passam para o
 * sobrevivente. Se ele já tem a conversa do mesmo contato, as mensagens vão
 * para ela e a janela de atendimento fica com o que for mais recente.
 */
async function moveConversations(
  ctx: UseCaseContext,
  survivorId: string,
  mergedId: string,
  pairs: Map<string, string>,
) {
  const theirs = await ctx.tx.conversation.findMany({ where: { leadId: mergedId } });
  const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const conversation of theirs) {
    const contactPointId = conversation.contactPointId
      ? (pairs.get(conversation.contactPointId) ?? conversation.contactPointId)
      : null;
    const target = await ctx.tx.conversation.findUnique({
      where: {
        leadId_channel_externalThreadId: {
          leadId: survivorId,
          channel: conversation.channel,
          externalThreadId: conversation.externalThreadId,
        },
      },
    });
    if (!target) {
      await ctx.tx.conversation.update({
        where: { id: conversation.id },
        data: { leadId: survivorId, contactPointId },
      });
      continue;
    }
    await ctx.tx.message.updateMany({
      where: { conversationId: conversation.id },
      data: { conversationId: target.id },
    });
    await ctx.tx.conversation.update({
      where: { id: target.id },
      data: {
        lastInboundAt: latest(target.lastInboundAt, conversation.lastInboundAt),
        lastOutboundAt: latest(target.lastOutboundAt, conversation.lastOutboundAt),
        serviceWindowExpiresAt: latest(
          target.serviceWindowExpiresAt,
          conversation.serviceWindowExpiresAt,
        ),
        profileName: target.profileName ?? conversation.profileName,
        handle: target.handle ?? conversation.handle,
      },
    });
  }
}

/** Comentários no Instagram da Docline (Fase 8): passam para o sobrevivente. */
async function moveSocialComments(
  ctx: UseCaseContext,
  survivorId: string,
  mergedId: string,
  pairs: Map<string, string>,
) {
  for (const [from, to] of pairs) {
    await ctx.tx.socialComment.updateMany({
      where: { leadId: mergedId, contactPointId: from },
      data: { contactPointId: to },
    });
  }
  await ctx.tx.socialComment.updateMany({
    where: { leadId: mergedId },
    data: { leadId: survivorId },
  });
}

/** Decisões já tomadas sobre o lead mesclado valem para o sobrevivente. */
async function carryOverDecisions(
  ctx: UseCaseContext,
  survivorId: string,
  merged: { id: string; code: number },
  currentCandidateId: string,
) {
  const decided = await ctx.tx.duplicateCandidate.findMany({
    where: {
      id: { not: currentCandidateId },
      status: { in: ['KEPT_SEPARATE', 'IGNORED'] },
      OR: [{ leadAId: merged.id }, { leadBId: merged.id }],
    },
  });
  let carried = 0;
  for (const c of decided) {
    const other = c.leadAId === merged.id ? c.leadBId : c.leadAId;
    if (other === survivorId) continue;
    const [leadAId, leadBId] = survivorId < other ? [survivorId, other] : [other, survivorId];
    const created = await ctx.tx.duplicateCandidate.createMany({
      data: [
        {
          leadAId,
          leadBId,
          score: c.score,
          confidence: c.confidence,
          reasons: c.reasons as Prisma.InputJsonValue,
          status: c.status,
          detectedBy: c.detectedBy,
          detectedAt: c.detectedAt,
          decidedById: c.decidedById,
          decidedAt: c.decidedAt,
          decisionNote: [
            `Decisão herdada da mesclagem de ${formatLeadCode(merged.code)}.`,
            c.decisionNote,
          ]
            .filter(Boolean)
            .join(' '),
        },
      ],
      // O par do sobrevivente já existe: a decisão dele prevalece.
      skipDuplicates: true,
    });
    carried += created.count;
  }
  return carried;
}

/**
 * Mesclar (F3-10; docs/MVP.md M06): o sobrevivente fica com os campos
 * escolhidos e recebe contatos, pessoas, origens, tags, observações, eventos,
 * responsáveis, bases legais e solicitações de titulares do outro. O outro
 * vira MERGED e aponta para o sobrevivente; a cópia integral dele fica em
 * `lead_merges`. **Nada é excluído.**
 */
export const mergeDuplicate = defineUseCase({
  name: 'dedup.merge',
  access: 'duplicate.decide',
  input: mergeDuplicateInput,
  async run(ctx, input) {
    const candidate = await lockCandidate(ctx, input.candidateId);
    if (candidate.status !== 'PENDING' && candidate.status !== 'IGNORED') {
      throw new BusinessRuleError('Este par já foi decidido.');
    }
    if (input.survivorId !== candidate.leadAId && input.survivorId !== candidate.leadBId) {
      throw new ValidationError([
        { path: 'survivorId', message: 'O lead que fica precisa ser um dos dois do par.' },
      ]);
    }
    const mergedId = input.survivorId === candidate.leadAId ? candidate.leadBId : candidate.leadAId;
    // Trava os dois leads, sempre na mesma ordem (evita impasse com outra mesclagem).
    await ctx.tx.$queryRaw`
      SELECT id FROM leads WHERE id = ANY(${[candidate.leadAId, candidate.leadBId]}::uuid[])
      ORDER BY id FOR UPDATE`;
    const survivor = await loadForMerge(ctx, input.survivorId);
    const merged = await loadForMerge(ctx, mergedId);
    if (
      input.versions &&
      (input.versions.survivor !== survivor.version || input.versions.merged !== merged.version)
    ) {
      throw new ConflictError(
        'Um dos leads foi alterado. Recarregue a comparação e tente de novo.',
      );
    }

    const survivorCode = formatLeadCode(survivor.code);
    const mergedCode = formatLeadCode(merged.code);
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const choices: MergeChoices = {
      ...defaultMergeChoices(survivor as MergeableLead, merged as MergeableLead),
      ...input.choices,
    };
    const { patch, fields } = mergedColumns(
      survivor as MergeableLead,
      merged as MergeableLead,
      choices,
    );
    const names = buildLeadNames({
      tradeName: ('tradeName' in patch ? patch.tradeName : survivor.tradeName) as string | null,
      companyName: ('companyName' in patch ? patch.companyName : survivor.companyName) as
        string | null,
    });
    if (!names) {
      throw new ValidationError([
        { path: 'choices', message: 'O lead precisa ficar com nome fantasia ou razão social.' },
      ]);
    }

    // Uma oportunidade aberta por lead: com duas, o comercial decide antes qual fica.
    const openOpportunities = await ctx.tx.opportunity.count({
      where: { leadId: { in: [survivor.id, merged.id] }, status: 'OPEN' },
    });
    if (openOpportunities > 1) {
      throw new BusinessRuleError(
        'Os dois leads têm oportunidade aberta com o Comercial. Encerre uma delas antes de mesclar.',
      );
    }

    // O mesclado sai da cadência e não deixa tarefa aberta.
    await stopLeadEnrollment(
      ctx.tx,
      merged.id,
      'LEAD_MERGED',
      ctx.now,
      engagementActorOf(ctx.actor),
    );
    await cancelOpenTasks(ctx.tx, merged.id, `Lead mesclado em ${survivorCode}.`);

    // A etapa escolhida do outro lead entra pelo pipeline (com histórico), não como coluna.
    const { stageId: chosenStageId, ...columns } = patch;
    const stageFromMerged =
      typeof chosenStageId === 'string' && chosenStageId !== survivor.stageId
        ? chosenStageId
        : null;

    // 1. O mesclado sai primeiro (libera o CNPJ, que é único entre leads não mesclados)
    // e deixa o funil: a passagem aberta dele no pipeline é encerrada.
    const mergedOpenStage = await ctx.tx.leadStageHistory.findFirst({
      where: { leadId: merged.id, leftAt: null },
      select: { id: true, enteredAt: true },
    });
    if (mergedOpenStage) {
      await ctx.tx.leadStageHistory.update({
        where: { id: mergedOpenStage.id },
        data: {
          leftAt: ctx.now,
          durationSeconds: Math.max(
            0,
            Math.round((ctx.now.getTime() - mergedOpenStage.enteredAt.getTime()) / 1000),
          ),
        },
      });
    }
    await ctx.tx.lead.update({
      where: { id: merged.id },
      data: {
        status: 'MERGED',
        mergedIntoId: survivor.id,
        version: { increment: 1 },
        lastActivityAt: ctx.now,
      },
    });
    // Leads que já tinham sido mesclados nele passam a apontar para o sobrevivente.
    await ctx.tx.lead.updateMany({
      where: { mergedIntoId: merged.id },
      data: { mergedIntoId: survivor.id },
    });

    // 2. Campos escolhidos, nomes e campos extras no sobrevivente.
    const ownerChanged = 'ownerId' in columns && columns.ownerId !== survivor.ownerId;
    await ctx.tx.lead.update({
      where: { id: survivor.id },
      data: {
        ...(columns as Prisma.LeadUncheckedUpdateInput),
        ...names,
        customFields:
          (mergeCustomFields(
            survivor.customFields,
            merged.customFields,
          ) as Prisma.InputJsonValue | null) ?? undefined,
        ...(ownerChanged
          ? { previousOwnerId: survivor.ownerId, assignedAt: columns.ownerId ? ctx.now : null }
          : {}),
        version: { increment: 1 },
        lastActivityAt: ctx.now,
      },
    });
    if (ownerChanged) {
      await ctx.tx.leadAssignment.create({
        data: {
          leadId: survivor.id,
          fromUserId: survivor.ownerId,
          toUserId: (columns.ownerId as string | null) ?? null,
          strategy: 'MANUAL',
          assignedById: actorId,
          reason: `Mesclagem com ${mergedCode}`,
          assignedAt: ctx.now,
        },
      });
    }

    if (stageFromMerged) {
      const [from, to] = await Promise.all([
        survivor.stageId
          ? ctx.tx.pipelineStage.findUnique({
              where: { id: survivor.stageId },
              select: stageRefSelect,
            })
          : null,
        ctx.tx.pipelineStage.findUniqueOrThrow({
          where: { id: stageFromMerged },
          select: stageRefSelect,
        }),
      ]);
      await applyStageChange(ctx, {
        lead: { id: survivor.id, version: survivor.version + 1, stageId: survivor.stageId },
        from,
        to,
        changedById: actorId,
        source: 'MERGE',
        lossReason: merged.lossReasonId
          ? await ctx.tx.lossReason.findUnique({
              where: { id: merged.lossReasonId },
              select: { id: true, key: true, name: true },
            })
          : null,
        note: `Etapa de ${mergedCode} escolhida na mesclagem.`,
      });
    }

    // 3. Filhos do mesclado.
    const survivorPrimaryPerson = await ctx.tx.leadPerson.count({
      where: { leadId: survivor.id, isPrimary: true },
    });
    const people = await ctx.tx.leadPerson.findMany({
      where: { leadId: merged.id },
      select: { id: true },
    });
    if (survivorPrimaryPerson > 0) {
      await ctx.tx.leadPerson.updateMany({
        where: { leadId: merged.id },
        data: { isPrimary: false },
      });
    }
    await ctx.tx.leadPerson.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });
    const contacts = await moveContactPoints(ctx, survivor, merged);
    const permissions = await movePermissions(
      ctx,
      survivor.id,
      merged.id,
      contacts.moved,
      contacts.pairs,
    );

    const origins = await ctx.tx.leadOrigin.findMany({
      where: { leadId: merged.id },
      select: { id: true },
    });
    await ctx.tx.leadOrigin.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id, isFirstTouch: false },
    });

    const tags = await ctx.tx.leadTag.findMany({
      where: { leadId: merged.id },
      select: { tagId: true },
    });
    const tagsAdded = await ctx.tx.leadTag.createMany({
      data: tags.map((t) => ({
        leadId: survivor.id,
        tagId: t.tagId,
        addedById: actorId,
        addedAt: ctx.now,
      })),
      skipDuplicates: true,
    });

    const [
      notes,
      events,
      assignments,
      requests,
      messages,
      activities,
      tasks,
      opportunities,
      aiGenerations,
    ] = await Promise.all([
      ctx.tx.leadNote.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.leadEvent.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.leadAssignment.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.dataSubjectRequest.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.message.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.activity.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.task.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.opportunity.findMany({ where: { leadId: merged.id }, select: { id: true } }),
      ctx.tx.aiGeneration.findMany({ where: { leadId: merged.id }, select: { id: true } }),
    ]);
    // Histórico comercial (Fases 5–6): mensagens, atividades, tarefas (já fechadas),
    // oportunidades e gerações da IA.
    const toSurvivor = { where: { leadId: merged.id }, data: { leadId: survivor.id } };
    await ctx.tx.message.updateMany(toSurvivor);
    await ctx.tx.activity.updateMany(toSurvivor);
    await ctx.tx.task.updateMany(toSurvivor);
    await ctx.tx.opportunity.updateMany(toSurvivor);
    await ctx.tx.aiGeneration.updateMany(toSurvivor);
    await moveConversations(ctx, survivor.id, merged.id, contacts.pairs);
    await moveSocialComments(ctx, survivor.id, merged.id, contacts.pairs);
    await mergeContactDates(ctx, survivor.id, merged.id);
    await ctx.tx.leadNote.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });
    // lead_events é append-only, mas o trigger permite trocar o lead_id (mesclagem).
    await ctx.tx.leadEvent.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });
    await ctx.tx.leadAssignment.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });
    await ctx.tx.dataSubjectRequest.updateMany({
      where: { leadId: merged.id },
      data: { leadId: survivor.id },
    });

    // 4. "Não contatar este lead" do mesclado passa a valer para o sobrevivente.
    const leadSuppressions = await ctx.tx.suppressionEntry.findMany({
      where: { type: 'LEAD', valueHash: merged.id, revokedAt: null },
    });
    if (leadSuppressions.length > 0) {
      await suppressIdentifiers(
        ctx,
        leadSuppressions.map((s) => ({
          type: 'LEAD' as const,
          valueHash: survivor.id,
          valueMasked: survivorCode,
          scope: s.scope,
          reason: s.reason,
          source: s.source,
          leadId: survivor.id,
          notes: `Herdado da mesclagem de ${mergedCode}.`,
        })),
      );
    }

    // 5. Decisão do par, decisões herdadas e registro da mesclagem.
    await ctx.tx.duplicateCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'MERGED',
        decidedById: actorId,
        decidedAt: ctx.now,
        decisionNote: input.note,
      },
    });
    const carried = await carryOverDecisions(ctx, survivor.id, merged, candidate.id);
    const moved = {
      people: people.map((p) => p.id),
      contactPoints: contacts.moved,
      permissions: permissions.moved,
      origins: origins.map((o) => o.id),
      notes: notes.map((n) => n.id),
      events: events.map((e) => e.id),
      assignments: assignments.map((a) => a.id),
      dataSubjectRequests: requests.map((r) => r.id),
      messages: messages.map((m) => m.id),
      activities: activities.map((a) => a.id),
      tasks: tasks.map((t) => t.id),
      opportunities: opportunities.map((o) => o.id),
      aiGenerations: aiGenerations.map((g) => g.id),
    };
    const record = await ctx.tx.leadMerge.create({
      data: {
        survivorLeadId: survivor.id,
        mergedLeadId: merged.id,
        candidateId: candidate.id,
        fieldChoices: toJson(choices),
        mergedSnapshot: toJson({
          lead: merged,
          moved,
          keptOnMerged: { contactPoints: contacts.kept, permissions: permissions.kept },
          tagsCopied: tagsAdded.count,
        }),
        performedById: actorId,
        performedAt: ctx.now,
      },
      select: { id: true },
    });

    // 6. Caches, timeline, auditoria e nova busca de duplicados do sobrevivente.
    await refreshLeadContactState(ctx.tx, survivor.id, ctx.now);
    await refreshLeadContactState(ctx.tx, merged.id, ctx.now);
    const counts = Object.fromEntries(Object.entries(moved).map(([k, ids]) => [k, ids.length]));
    const actorType = ctx.actor.kind === 'user' ? ('USER' as const) : ('SYSTEM' as const);
    await ctx.tx.leadEvent.createMany({
      data: [
        {
          leadId: survivor.id,
          type: LEAD_EVENTS.merged,
          occurredAt: ctx.now,
          actorType,
          actorId,
          payload: toJson({ mergedLeadId: merged.id, mergedCode, fields, moved: counts }),
          subjectType: 'lead_merge',
          subjectId: record.id,
        },
        {
          leadId: merged.id,
          type: LEAD_EVENTS.mergedInto,
          occurredAt: ctx.now,
          actorType,
          actorId,
          payload: toJson({ survivorLeadId: survivor.id, survivorCode }),
          subjectType: 'lead_merge',
          subjectId: record.id,
        },
      ],
    });
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [column, value] of Object.entries(patch)) {
      // A etapa já tem evento e auditoria próprios (stage.changed).
      if (['cnpjHash', 'cnpjRoot', 'websiteDomain', 'stageId'].includes(column)) continue;
      const before = survivor[column as keyof FullLead];
      changes[column] =
        column === 'cnpj'
          ? [
              before ? maskIdentifier('CNPJ', before as string) : null,
              value ? maskIdentifier('CNPJ', value as string) : null,
            ]
          : [before ?? null, value ?? null];
    }
    await ctx.audit({
      action: 'lead.merge',
      entityType: 'lead',
      entityId: survivor.id,
      changes: Object.keys(changes).length ? changes : null,
      metadata: {
        mergedLeadId: merged.id,
        mergedCode,
        candidateId: candidate.id,
        mergeId: record.id,
        fields,
        moved: counts,
        revokedOptIns: permissions.revoked,
        decisionsCarried: carried,
        ...(input.note ? { note: input.note } : {}),
      },
    });
    await ctx.audit({
      action: 'lead.merged_into',
      entityType: 'lead',
      entityId: merged.id,
      changes: { status: [merged.status, 'MERGED'] },
      metadata: { survivorLeadId: survivor.id, survivorCode, mergeId: record.id },
    });
    await ctx.deps.jobs.enqueue(
      JOBS.dedupCheckLead.name,
      { leadIds: [survivor.id], source: 'MANUAL' },
      { tx: ctx.tx },
    );

    return {
      mergeId: record.id,
      survivorId: survivor.id,
      survivorCode,
      mergedId: merged.id,
      mergedCode,
      fields,
      moved: counts,
    };
  },
});

/** Datas de contato do lead que fica: o primeiro contato mais antigo e o último mais recente. */
async function mergeContactDates(ctx: UseCaseContext, survivorId: string, mergedId: string) {
  const [a, b] = await Promise.all(
    [survivorId, mergedId].map((id) =>
      ctx.tx.lead.findUniqueOrThrow({
        where: { id },
        select: {
          firstContactAt: true,
          lastContactAt: true,
          firstReplyAt: true,
          lastInboundAt: true,
        },
      }),
    ),
  );
  const pick = (x: Date | null, y: Date | null, earliest: boolean) =>
    x && y ? (x < y === earliest ? x : y) : (x ?? y);
  await ctx.tx.lead.update({
    where: { id: survivorId },
    data: {
      firstContactAt: pick(a!.firstContactAt, b!.firstContactAt, true),
      lastContactAt: pick(a!.lastContactAt, b!.lastContactAt, false),
      firstReplyAt: pick(a!.firstReplyAt, b!.firstReplyAt, true),
      lastInboundAt: pick(a!.lastInboundAt, b!.lastInboundAt, false),
    },
  });
  await refreshNextAction(ctx.tx, survivorId);
}
