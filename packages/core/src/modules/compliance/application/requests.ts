import { z } from 'zod';
import { NotFoundError } from '../../../shared/errors';
import { diffFields } from '../../../shared/diff';
import { defineUseCase } from '../../../shared/use-case';
import {
  createDataSubjectRequestInput,
  createLegalBasisAssessmentInput,
  listDataSubjectRequestsInput,
  updateDataSubjectRequestInput,
} from '../contracts/schemas';

/**
 * Prazo de resposta: 15 dias para a declaração completa (LGPD art. 19, II).
 * A resposta simplificada é imediata; o prazo exato de cada caso é validado
 * pelo jurídico (docs/LGPD.md §10).
 */
export const DSR_RESPONSE_DAYS = 15;

const dsrSelect = {
  id: true,
  requesterName: true,
  requesterContact: true,
  type: true,
  status: true,
  receivedAt: true,
  dueAt: true,
  resolvedAt: true,
  responseSummary: true,
  notes: true,
  createdAt: true,
  lead: { select: { id: true, code: true, displayName: true, status: true } },
} as const;

/** Registro manual de solicitação de titular (F2-15). Só ADMIN (encarregado/DPO). */
export const createDataSubjectRequest = defineUseCase({
  name: 'compliance.createDataSubjectRequest',
  access: 'dsr.manage',
  input: createDataSubjectRequestInput,
  async run(ctx, input) {
    if (input.leadId) {
      const exists = await ctx.tx.lead.count({ where: { id: input.leadId } });
      if (exists === 0) throw new NotFoundError('Lead não encontrado.');
    }
    const dueAt = new Date(input.receivedAt.getTime() + DSR_RESPONSE_DAYS * 86_400_000);
    const request = await ctx.tx.dataSubjectRequest.create({
      data: {
        requesterName: input.requesterName,
        requesterContact: input.requesterContact,
        type: input.type,
        leadId: input.leadId ?? null,
        receivedAt: input.receivedAt,
        dueAt,
        notes: input.notes ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      select: dsrSelect,
    });
    // A auditoria registra o pedido sem os dados de contato do titular.
    await ctx.audit({
      action: 'dsr.create',
      entityType: 'data_subject_request',
      entityId: request.id,
      changes: { type: [null, request.type], leadId: [null, request.lead?.id ?? null] },
    });
    return request;
  },
});

export const updateDataSubjectRequest = defineUseCase({
  name: 'compliance.updateDataSubjectRequest',
  access: 'dsr.manage',
  input: updateDataSubjectRequestInput,
  async run(ctx, { requestId, ...input }) {
    const current = await ctx.tx.dataSubjectRequest.findUnique({ where: { id: requestId } });
    if (!current) throw new NotFoundError('Solicitação não encontrada.');
    if (input.leadId) {
      const exists = await ctx.tx.lead.count({ where: { id: input.leadId } });
      if (exists === 0) throw new NotFoundError('Lead não encontrado.');
    }
    const finished = input.status === 'COMPLETED' || input.status === 'REJECTED';
    const data = {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
      ...(input.responseSummary !== undefined ? { responseSummary: input.responseSummary } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(finished && !current.resolvedAt
        ? {
            resolvedAt: ctx.now,
            handledById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
          }
        : {}),
    };
    const changes = diffFields(current, data, ['status', 'leadId']);
    if ('responseSummary' in data && data.responseSummary !== current.responseSummary) {
      changes.responseSummary = ['…', '…'];
    }
    const updated = await ctx.tx.dataSubjectRequest.update({
      where: { id: requestId },
      data,
      select: dsrSelect,
    });
    if (Object.keys(changes).length > 0) {
      await ctx.audit({
        action: 'dsr.update',
        entityType: 'data_subject_request',
        entityId: requestId,
        changes,
      });
    }
    return updated;
  },
});

export const listDataSubjectRequests = defineUseCase({
  name: 'compliance.listDataSubjectRequests',
  access: 'dsr.manage',
  input: listDataSubjectRequestsInput,
  async run(ctx, input) {
    const rows = await ctx.tx.dataSubjectRequest.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: dsrSelect,
    });
    const page = rows.slice(0, input.limit);
    return {
      data: page.map((r) => ({
        ...r,
        overdue: !r.resolvedAt && r.dueAt.getTime() < ctx.now.getTime(),
      })),
      nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
    };
  },
});

/** Avaliações de base legal (ex.: LIA) disponíveis para vincular a leads. */
export const listLegalBasisAssessments = defineUseCase({
  name: 'compliance.listLegalBasisAssessments',
  access: 'lead.read',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async run(ctx, input) {
    return ctx.tx.legalBasisAssessment.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        name: true,
        legalBasis: true,
        purpose: true,
        documentUrl: true,
        version: true,
        approvedBy: true,
        approvedAt: true,
        validUntil: true,
        active: true,
      },
    });
  },
});

export const createLegalBasisAssessment = defineUseCase({
  name: 'compliance.createLegalBasisAssessment',
  access: 'settings.manage',
  input: createLegalBasisAssessmentInput,
  async run(ctx, input) {
    const previous = await ctx.tx.legalBasisAssessment.findFirst({
      where: { name: input.name },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const assessment = await ctx.tx.legalBasisAssessment.create({
      data: {
        ...input,
        documentUrl: input.documentUrl ?? null,
        approvedBy: input.approvedBy ?? null,
        approvedAt: input.approvedAt ?? null,
        validUntil: input.validUntil ?? null,
        version: (previous?.version ?? 0) + 1,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    await ctx.audit({
      action: 'legal_basis_assessment.create',
      entityType: 'legal_basis_assessment',
      entityId: assessment.id,
      changes: { name: [null, assessment.name], version: [null, assessment.version] },
    });
    return assessment;
  },
});
