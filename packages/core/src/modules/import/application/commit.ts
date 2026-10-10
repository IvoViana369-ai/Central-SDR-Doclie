import { JOBS } from '../../../jobs/catalog';
import {
  BusinessRuleError,
  isDomainError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import {
  auditData,
  defineUseCase,
  toJson,
  type CoreDeps,
  type UseCaseContext,
} from '../../../shared/use-case';
import { refreshLeadContactState } from '../../compliance';
import { detectDuplicates } from '../../dedup';
import { resolveActor } from '../../identity';
import {
  createLeadInput,
  formatLeadCode,
  insertLead,
  LEAD_EVENTS,
  prepareLeadCreation,
} from '../../leads';
import { z } from 'zod';
import { importBatchIdInput } from '../contracts/schemas';
import type { NormalizedImportRow } from '../domain/row';
import { IMPORT_RETENTION_DAYS, requireBatch } from './batches';
import { fillEmptyLeadFields } from '../infra/fill-empty';

const DAY_MS = 86_400_000;

/** Confirma a prévia e dispara a gravação no worker (F3-06). */
export const commitImport = defineUseCase({
  name: 'import.commit',
  access: 'lead.import',
  input: importBatchIdInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    if (batch.status !== 'PREVIEW_READY') {
      throw new BusinessRuleError('Revise a prévia antes de confirmar a importação.');
    }
    await ctx.tx.importBatch.update({
      where: { id: batch.id },
      data: { status: 'COMMITTING', progress: 0 },
    });
    await ctx.deps.jobs.enqueue(JOBS.importCommit.name, { batchId: batch.id }, { tx: ctx.tx });
    await ctx.audit({
      action: 'import.commit',
      entityType: 'import_batch',
      entityId: batch.id,
      metadata: { stats: batch.stats ?? null },
    });
    return { batchId: batch.id, status: 'COMMITTING' as const };
  },
});

type Batch = Awaited<ReturnType<typeof requireBatch>>;

/** Lead existente para vincular ou completar (segue a mesclagem, se houver). */
async function targetLead(ctx: UseCaseContext, leadId: string) {
  let lead = await ctx.tx.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, mergedIntoId: true },
  });
  for (let hops = 0; lead?.status === 'MERGED' && lead.mergedIntoId && hops < 5; hops++) {
    lead = await ctx.tx.lead.findUnique({
      where: { id: lead.mergedIntoId },
      select: { id: true, status: true, mergedIntoId: true },
    });
  }
  if (!lead || (lead.status !== 'ACTIVE' && lead.status !== 'ARCHIVED')) {
    throw new BusinessRuleError('O lead existente não está mais disponível.');
  }
  return lead.id;
}

async function addOriginAndTags(
  ctx: UseCaseContext,
  batch: Batch,
  leadId: string,
  tagIds: string[],
) {
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  await ctx.tx.leadOrigin.create({
    data: {
      leadId,
      sourceId: batch.sourceId!,
      detail: batch.sourceDetail,
      collectedAt: batch.collectedAt!,
      importBatchId: batch.id,
      createdById: actorId,
    },
  });
  const tags = [...new Set([...batch.defaultTagIds, ...tagIds])];
  if (tags.length) {
    await ctx.tx.leadTag.createMany({
      data: tags.map((tagId) => ({ leadId, tagId, addedById: actorId })),
      skipDuplicates: true,
    });
  }
}

/** Completa só os campos vazios do lead existente e acrescenta contatos e pessoa novos. */
const processRowInput = z.object({ batchId: z.uuid(), rowId: z.uuid() });

/** Grava uma linha (transação própria): cria, vincula ou completa o lead. */
export const processImportRow = defineUseCase({
  name: 'import.processRow',
  access: 'lead.import',
  input: processRowInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    const row = await ctx.tx.importRow.findFirst({
      where: { id: input.rowId, batchId: batch.id },
      select: {
        id: true,
        rowNumber: true,
        status: true,
        decision: true,
        normalized: true,
        matchStatus: true,
        matchedLeadId: true,
        matchReasons: true,
      },
    });
    if (!row) throw new NotFoundError('Linha não encontrada.');
    if (row.status !== 'PENDING' || !row.decision || row.decision === 'SKIP') return null;
    const n = row.normalized as NormalizedImportRow | null;
    if (!n) throw new ValidationError([{ path: 'row', message: 'Linha inválida.' }]);

    if (row.decision === 'IMPORT') {
      const parsed = createLeadInput.parse({
        tradeName: n.tradeName,
        companyName: n.companyName,
        cnpj: n.cnpj,
        municipalityCode: n.municipalityCode,
        cityRaw: n.municipalityCode ? null : n.cityName,
        stateUf: n.municipalityCode ? null : n.stateUf,
        postalCode: n.postalCode,
        addressLine: n.addressLine,
        addressNumber: n.addressNumber,
        addressComplement: n.addressComplement,
        neighborhood: n.neighborhood,
        website: n.website,
        segmentId: n.segmentId,
        category: n.category,
        description: n.description,
        origin: {
          sourceId: batch.sourceId,
          detail: batch.sourceDetail,
          collectedAt: batch.collectedAt,
        },
        legalBasis: batch.defaultLegalBasis,
        legalBasisAssessmentId: batch.legalBasisAssessmentId,
        people: n.person ? [{ fullName: n.person.fullName, roleTitle: n.person.roleTitle }] : [],
        contactPoints: n.contacts.map((c) => ({
          type: c.type,
          value: c.value,
          isWhatsapp: c.isWhatsapp,
          label: c.label,
        })),
        tagIds: [...new Set([...batch.defaultTagIds, ...n.tagIds])],
        ownerId: batch.defaultOwnerId ?? null,
        acknowledgeDuplicates: true,
      });
      const prepared = await prepareLeadCreation(ctx, parsed);
      let duplicateCodes: string[] = [];
      if (row.matchedLeadId) {
        const matched = await ctx.tx.lead.findUnique({
          where: { id: row.matchedLeadId },
          select: { code: true },
        });
        if (matched) duplicateCodes = [formatLeadCode(matched.code)];
      }
      const lead = await insertLead(ctx, prepared, {
        createdVia: 'IMPORT',
        importBatchId: batch.id,
        duplicateCodes,
        customFields: Object.keys(n.customFields).length ? n.customFields : null,
      });
      // Busca completa de duplicados do lead novo (não só o da prévia), para a fila de revisão.
      const { byLead } = await detectDuplicates(
        ctx.tx,
        { kind: 'leads', ids: [lead.id] },
        'IMPORT',
        ctx.now,
      );
      const flagged = (byLead.get(lead.id) ?? []).some(
        (r) => r === 'created' || r === 'updated' || r === 'reopened',
      );
      await ctx.tx.importRow.update({
        where: { id: row.id },
        data: { status: 'DONE', resultLeadId: lead.id, error: null },
      });
      return { result: 'created' as const, leadId: lead.id, flagged };
    }

    const leadId = await targetLead(ctx, row.matchedLeadId!);
    let changes: Record<string, [unknown, unknown]> = {};
    if (row.decision === 'UPDATE_EXISTING')
      changes = await fillEmptyLeadFields(ctx, batch, leadId, n);
    await addOriginAndTags(ctx, batch, leadId, n.tagIds);
    if (Object.keys(changes).length > 0) {
      // Dados novos no existente (contatos, CNPJ, site) podem revelar outros duplicados.
      await detectDuplicates(ctx.tx, { kind: 'leads', ids: [leadId] }, 'IMPORT', ctx.now);
    }
    await refreshLeadContactState(ctx.tx, leadId, ctx.now);
    const actorType = ctx.actor.kind === 'user' ? ('USER' as const) : ('SYSTEM' as const);
    await ctx.tx.leadEvent.create({
      data: {
        leadId,
        type:
          row.decision === 'UPDATE_EXISTING' && Object.keys(changes).length
            ? LEAD_EVENTS.updated
            : LEAD_EVENTS.originAdded,
        occurredAt: ctx.now,
        actorType,
        actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        payload: toJson({ importBatchId: batch.id, fields: Object.keys(changes) }),
      },
    });
    await ctx.tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: ctx.now } });
    await ctx.audit({
      action: row.decision === 'UPDATE_EXISTING' ? 'lead.import_update' : 'lead.import_link',
      entityType: 'lead',
      entityId: leadId,
      changes: Object.keys(changes).length ? changes : null,
      metadata: { importBatchId: batch.id, rowNumber: row.rowNumber },
    });
    await ctx.tx.importRow.update({
      where: { id: row.id },
      data: { status: 'DONE', resultLeadId: leadId, error: null },
    });
    return {
      result: row.decision === 'UPDATE_EXISTING' ? ('updated' as const) : ('linked' as const),
      leadId,
      flagged: false,
    };
  },
});

/** Contagens finais do relatório (M04). */
async function reportStats(db: CoreDeps['db'], batchId: string) {
  const [done, errors, skipped, byStatus, flagged, created] = await Promise.all([
    db.importRow.groupBy({
      by: ['decision'],
      where: { batchId, status: 'DONE' },
      _count: { _all: true },
    }),
    db.importRow.count({ where: { batchId, status: 'ERROR' } }),
    db.importRow.count({ where: { batchId, decision: 'SKIP' } }),
    db.importRow.groupBy({
      by: ['matchStatus'],
      where: { batchId, matchStatus: { not: null } },
      _count: { _all: true },
    }),
    // Pares em que um dos lados foi criado por este lote (o lead novo pode ser o A ou o B).
    db.duplicateCandidate.count({
      where: {
        detectedBy: 'IMPORT',
        OR: [
          { leadA: { origins: { some: { importBatchId: batchId, isFirstTouch: true } } } },
          { leadB: { origins: { some: { importBatchId: batchId, isFirstTouch: true } } } },
        ],
      },
    }),
    db.lead.count({ where: { origins: { some: { importBatchId: batchId, isFirstTouch: true } } } }),
  ]);
  const doneBy = Object.fromEntries(done.map((g) => [g.decision, g._count._all]));
  const statusBy = Object.fromEntries(byStatus.map((g) => [g.matchStatus, g._count._all]));
  return {
    created,
    linked: doneBy.LINK_EXISTING ?? 0,
    updated: doneBy.UPDATE_EXISTING ?? 0,
    skipped,
    errors,
    suppressed: statusBy.SUPPRESSED ?? 0,
    invalid: statusBy.INVALID ?? 0,
    duplicatesFlagged: flagged,
  };
}

/**
 * Job `import.commit`: grava as linhas confirmadas, uma transação por linha
 * (erro numa linha não derruba as outras), com progresso. Retoma de onde
 * parou se o worker cair: só linhas pendentes são processadas.
 */
export async function runImportCommit(deps: CoreDeps, job: { batchId: string }): Promise<void> {
  const batch = await deps.db.importBatch.findUnique({
    where: { id: job.batchId },
    select: { id: true, status: true, createdById: true },
  });
  if (!batch || batch.status !== 'COMMITTING') return;
  const actor = await resolveActor(deps.db, batch.createdById);
  if (!actor || actor.kind !== 'user' || actor.status !== 'ACTIVE') {
    await deps.db.importBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', error: 'Quem iniciou a importação não tem mais acesso ativo.' },
    });
    return;
  }

  const meta = { requestId: `import:${batch.id}` };
  let processed = await deps.db.importRow.count({
    where: { batchId: batch.id, status: { not: 'PENDING' } },
  });
  for (;;) {
    const rows = await deps.db.importRow.findMany({
      where: {
        batchId: batch.id,
        status: 'PENDING',
        decision: { in: ['IMPORT', 'LINK_EXISTING', 'UPDATE_EXISTING'] },
      },
      orderBy: { rowNumber: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await processImportRow(deps, actor, { batchId: batch.id, rowId: row.id }, meta);
      } catch (error) {
        const message = isDomainError(error)
          ? error instanceof ValidationError
            ? error.issues.map((i) => i.message).join(' ')
            : error.message
          : 'Erro inesperado ao gravar a linha.';
        if (!isDomainError(error))
          deps.logger.error({ err: error, batchId: batch.id }, 'Falha ao importar linha');
        await deps.db.importRow.update({
          where: { id: row.id },
          data: { status: 'ERROR', error: message },
        });
      }
      processed += 1;
    }
    await deps.db.importBatch.update({ where: { id: batch.id }, data: { progress: processed } });
  }

  const now = deps.clock.now();
  const stats = await reportStats(deps.db, batch.id);
  await deps.db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      purgeAfter: new Date(now.getTime() + IMPORT_RETENTION_DAYS * DAY_MS),
      stats: toJson(stats),
    },
  });
  await deps.db.auditLog.create({
    data: auditData(actor, meta, {
      action: 'import.completed',
      entityType: 'import_batch',
      entityId: batch.id,
      metadata: stats,
    }),
  });
}

/** Relatório final: contagens e as linhas com erro (F3-06). */
export const getImportReport = defineUseCase({
  name: 'import.report',
  access: 'lead.import',
  input: importBatchIdInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    const errorRows = await ctx.tx.importRow.findMany({
      where: { batchId: batch.id, status: 'ERROR' },
      orderBy: { rowNumber: 'asc' },
      take: 200,
      select: { id: true, rowNumber: true, error: true },
    });
    return { batch, errorRows };
  },
});
