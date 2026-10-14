import type {
  DbTransaction,
  DuplicatePolicy,
  ImportMatchStatus,
  ImportRowDecision,
  Prisma,
} from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  type ValidationIssue,
} from '../../../shared/errors';
import { defineUseCase, toJson, type CoreDeps } from '../../../shared/use-case';
import { formatLeadCode } from '../../leads';
import { MunicipalityIndex, toSearchKey } from '../../normalization';
import {
  configureImportInput,
  importPreviewInput,
  setDecisionsByStatusInput,
  setRowDecisionInput,
} from '../contracts/schemas';
import { allowedDecisions, defaultDecision, type MatchReason } from '../domain/decisions';
import {
  headerSignature,
  IMPORT_FIELDS,
  type ColumnMapping,
  type ImportField,
} from '../domain/fields';
import { normalizeImportRow, type NormalizedImportRow, type RowIssue } from '../domain/row';
import { InFileIndex, matchRows } from '../infra/matching';
import { requireBatch } from './batches';

const FUTURE_TOLERANCE_MS = 86_400_000;

/**
 * Configura o lote (F3-03, F3-04): mapeamento, linha do cabeçalho, origem,
 * data da coleta, base legal, responsável, tags e política de duplicados.
 * Dispara a prévia no worker.
 */
export const configureImport = defineUseCase({
  name: 'import.configure',
  access: 'lead.import',
  input: configureImportInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    if (batch.status !== 'MAPPING' && batch.status !== 'PREVIEW_READY') {
      throw new BusinessRuleError('Esta importação não está na etapa de mapeamento.');
    }
    const issues: ValidationIssue[] = [];
    const headerExists = await ctx.tx.importRow.count({
      where: { batchId: batch.id, rowNumber: input.headerRow },
    });
    if (!headerExists)
      issues.push({ path: 'headerRow', message: 'Linha do cabeçalho não encontrada.' });

    const columns = input.columns as ColumnMapping[];
    const used = new Map<string, number>();
    for (const column of columns) {
      if (column.target === 'custom' || column.target === 'ignore') continue;
      used.set(column.target, (used.get(column.target) ?? 0) + 1);
    }
    for (const [field, count] of used) {
      if (count > 1 && !IMPORT_FIELDS[field as ImportField].multiple) {
        issues.push({
          path: 'columns',
          message: `"${IMPORT_FIELDS[field as ImportField].label}" só pode vir de uma coluna.`,
        });
      }
    }
    if (!used.has('tradeName') && !used.has('companyName')) {
      issues.push({
        path: 'columns',
        message: 'Indique a coluna do nome (fantasia ou razão social).',
      });
    }

    const source = await ctx.tx.leadSource.findUnique({ where: { id: input.sourceId } });
    if (!source?.active) issues.push({ path: 'sourceId', message: 'Origem não encontrada.' });
    if (input.collectedAt.getTime() > ctx.now.getTime() + FUTURE_TOLERANCE_MS) {
      issues.push({ path: 'collectedAt', message: 'A data da coleta não pode ser futura.' });
    }
    if (input.legalBasisAssessmentId) {
      const assessment = await ctx.tx.legalBasisAssessment.findUnique({
        where: { id: input.legalBasisAssessmentId },
      });
      if (!assessment?.active)
        issues.push({ path: 'legalBasisAssessmentId', message: 'Avaliação não encontrada.' });
    }
    if (input.ownerId) {
      const owner = await ctx.tx.user.findUnique({
        where: { id: input.ownerId },
        select: { status: true },
      });
      if (owner?.status !== 'ACTIVE')
        issues.push({ path: 'ownerId', message: 'Responsável não encontrado ou inativo.' });
    }
    const tagIds = [...new Set(input.tagIds)];
    if (tagIds.length) {
      const found = await ctx.tx.tag.count({ where: { id: { in: tagIds }, active: true } });
      if (found !== tagIds.length) issues.push({ path: 'tagIds', message: 'Tag não encontrada.' });
    }
    if (issues.length) throw new ValidationError(issues);

    if (input.saveTemplateAs) {
      const signature = headerSignature(columns.map((c) => c.header));
      await ctx.tx.importMappingTemplate.upsert({
        where: { name: input.saveTemplateAs },
        create: {
          name: input.saveTemplateAs,
          headerSignature: signature,
          mapping: toJson(columns),
          createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        },
        update: { headerSignature: signature, mapping: toJson(columns) },
      });
    }

    await ctx.tx.importBatch.update({
      where: { id: batch.id },
      data: {
        headerRow: input.headerRow,
        rowCount: await ctx.tx.importRow.count({
          where: { batchId: batch.id, rowNumber: { gt: input.headerRow } },
        }),
        mapping: toJson({ columns }),
        duplicatePolicy: input.duplicatePolicy,
        sourceId: input.sourceId,
        sourceDetail: input.sourceDetail,
        collectedAt: input.collectedAt,
        defaultLegalBasis: input.legalBasis,
        legalBasisAssessmentId: input.legalBasisAssessmentId ?? null,
        defaultOwnerId: input.ownerId ?? null,
        defaultTagIds: tagIds,
        status: 'PREVIEWING',
        progress: 0,
        stats: undefined,
        error: null,
      },
    });
    await ctx.deps.jobs.enqueue(JOBS.importPreview.name, { batchId: batch.id }, { tx: ctx.tx });
    await ctx.audit({
      action: 'import.configure',
      entityType: 'import_batch',
      entityId: batch.id,
      metadata: {
        duplicatePolicy: input.duplicatePolicy,
        sourceKey: source!.key,
        legalBasis: input.legalBasis,
        mappedFields: [...used.keys()],
        customColumns: columns.filter((c) => c.target === 'custom').length,
      },
    });
    return { batchId: batch.id, status: 'PREVIEWING' as const };
  },
});

/** Contagens da prévia: por situação, por decisão e linhas com avisos. */
export async function previewStats(db: Pick<DbTransaction, 'importRow'>, batchId: string) {
  const [byStatus, byDecision, withWarnings] = await Promise.all([
    db.importRow.groupBy({
      by: ['matchStatus'],
      where: { batchId, matchStatus: { not: null } },
      _count: { _all: true },
    }),
    db.importRow.groupBy({
      by: ['decision'],
      where: { batchId, decision: { not: null } },
      _count: { _all: true },
    }),
    db.importRow.count({
      where: { batchId, warnings: { not: { equals: [] } }, matchStatus: { not: null } },
    }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((g) => [g.matchStatus, g._count._all])),
    byDecision: Object.fromEntries(byDecision.map((g) => [g.decision, g._count._all])),
    withWarnings,
  };
}

/**
 * Job `import.preview` (F3-05): normaliza e valida cada linha, casa com a
 * base, com o próprio arquivo e com a Lista Não Contatar, e propõe a decisão
 * pela política do lote. Grava em lotes de 1.000 linhas.
 */
export async function runImportPreview(deps: CoreDeps, job: { batchId: string }): Promise<void> {
  const batch = await deps.db.importBatch.findUnique({
    where: { id: job.batchId },
    select: { id: true, status: true, headerRow: true, mapping: true, duplicatePolicy: true },
  });
  if (!batch || batch.status !== 'PREVIEWING') return;
  const columns = (batch.mapping as unknown as { columns: ColumnMapping[] }).columns;

  const [municipalities, segments, tags] = await Promise.all([
    deps.db.municipality.findMany({
      select: { ibgeCode: true, name: true, uf: true, nameSearch: true, ddd: true },
    }),
    deps.db.segment.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true },
    }),
    deps.db.tag.findMany({ where: { active: true }, select: { id: true, nameSearch: true } }),
  ]);
  const context = {
    municipalities: new MunicipalityIndex(municipalities),
    segments: new Map(
      segments.flatMap((s) => [
        [toSearchKey(s.name), s.id],
        [toSearchKey(s.key), s.id],
      ]),
    ),
    tags: new Map(tags.map((t) => [t.nameSearch, t.id])),
  };

  const inFile = new InFileIndex();
  const CHUNK = 1_000;
  let processed = 0;
  let cursor = batch.headerRow;
  for (;;) {
    const rows = await deps.db.importRow.findMany({
      where: { batchId: batch.id, rowNumber: { gt: cursor } },
      orderBy: { rowNumber: 'asc' },
      take: CHUNK,
      select: { id: true, rowNumber: true, raw: true },
    });
    if (rows.length === 0) break;
    cursor = rows.at(-1)!.rowNumber;

    const normalizedRows = rows.map((row) => ({
      row,
      result: normalizeImportRow(row.raw as string[], columns, context),
    }));
    const valid = normalizedRows.flatMap(({ row, result }) =>
      result.normalized
        ? [{ id: row.id, rowNumber: row.rowNumber, normalized: result.normalized }]
        : [],
    );
    const matches = await deps.db.$transaction(
      (tx) => matchRows(tx, deps.identifiers, valid, inFile),
      {
        timeout: 60_000,
      },
    );

    const updates = normalizedRows.map(({ row, result }) => {
      const match = matches.get(row.id);
      const status: ImportMatchStatus = result.normalized ? match!.status : 'INVALID';
      const warnings: RowIssue[] = [
        ...result.warnings,
        ...(match?.warnings ?? []).map((message) => ({ column: null, message })),
      ];
      return {
        id: row.id,
        normalized: result.normalized ? JSON.stringify(result.normalized) : null,
        errors: JSON.stringify(result.errors),
        warnings: JSON.stringify(warnings),
        matchStatus: status,
        matchedLeadId: match?.matchedLeadId ?? null,
        matchReasons: JSON.stringify(match?.reasons ?? []),
        decision: defaultDecision(status, batch.duplicatePolicy as DuplicatePolicy),
      };
    });
    await deps.db.$executeRaw`
      UPDATE import_rows AS r SET
        normalized = v.normalized::jsonb,
        errors = v.errors::jsonb,
        warnings = v.warnings::jsonb,
        match_status = v.match_status::import_match_status,
        matched_lead_id = v.matched_lead_id::uuid,
        match_reasons = v.match_reasons::jsonb,
        decision = v.decision::import_row_decision,
        status = 'PENDING',
        error = NULL,
        result_lead_id = NULL
      FROM unnest(
        ${updates.map((u) => u.id)}::uuid[],
        ${updates.map((u) => u.normalized)}::text[],
        ${updates.map((u) => u.errors)}::text[],
        ${updates.map((u) => u.warnings)}::text[],
        ${updates.map((u) => u.matchStatus)}::text[],
        ${updates.map((u) => u.matchedLeadId)}::text[],
        ${updates.map((u) => u.matchReasons)}::text[],
        ${updates.map((u) => u.decision)}::text[]
      ) AS v(id, normalized, errors, warnings, match_status, matched_lead_id, match_reasons, decision)
      WHERE r.id = v.id`;
    processed += rows.length;
    await deps.db.importBatch.update({ where: { id: batch.id }, data: { progress: processed } });
  }

  await deps.db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: 'PREVIEW_READY',
      progress: processed,
      stats: toJson(await previewStats(deps.db, batch.id)),
    },
  });
}

const reasonsOf = (value: unknown) => (value as MatchReason[] | null) ?? [];

/** Prévia paginada (por linha da planilha), com filtros por situação e por avisos. */
export const getImportPreview = defineUseCase({
  name: 'import.preview',
  access: 'lead.import',
  input: importPreviewInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    const where: Prisma.ImportRowWhereInput = {
      batchId: batch.id,
      rowNumber: { gt: input.cursor ?? batch.headerRow },
      matchStatus: input.matchStatus ? input.matchStatus : { not: null },
      ...(input.withIssues
        ? {
            OR: [{ warnings: { not: { equals: [] } } }, { errors: { not: { equals: [] } } }],
          }
        : {}),
    };
    const rows = await ctx.tx.importRow.findMany({
      where,
      orderBy: { rowNumber: 'asc' },
      take: input.limit + 1,
      select: {
        id: true,
        rowNumber: true,
        raw: true,
        normalized: true,
        errors: true,
        warnings: true,
        matchStatus: true,
        matchedLeadId: true,
        matchReasons: true,
        decision: true,
        status: true,
        error: true,
        resultLeadId: true,
      },
    });
    const page = rows.slice(0, input.limit);
    const leadIds = [
      ...new Set(page.flatMap((r) => [r.matchedLeadId, r.resultLeadId]).filter(Boolean)),
    ] as string[];
    const leads = leadIds.length
      ? await ctx.tx.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, code: true, displayName: true },
        })
      : [];
    const leadById = new Map(leads.map((l) => [l.id, { ...l, code: formatLeadCode(l.code) }]));
    return {
      data: page.map((r) => {
        const reasons = reasonsOf(r.matchReasons);
        return {
          ...r,
          normalized: r.normalized as NormalizedImportRow | null,
          errors: (r.errors as RowIssue[] | null) ?? [],
          warnings: (r.warnings as RowIssue[] | null) ?? [],
          matchReasons: reasons,
          matchedLead: r.matchedLeadId ? (leadById.get(r.matchedLeadId) ?? null) : null,
          resultLead: r.resultLeadId ? (leadById.get(r.resultLeadId) ?? null) : null,
          allowedDecisions: r.matchStatus
            ? allowedDecisions(r.matchStatus, {
                hasMatch: Boolean(r.matchedLeadId),
                matchedByCnpj: reasons.some((m) => m.rule === 'CNPJ'),
              })
            : [],
        };
      }),
      nextCursor: rows.length > input.limit ? page.at(-1)!.rowNumber : null,
    };
  },
});

async function requireReadyBatch(ctx: Parameters<typeof requireBatch>[0], batchId: string) {
  const batch = await requireBatch(ctx, batchId);
  if (batch.status !== 'PREVIEW_READY') {
    throw new BusinessRuleError('As decisões só podem ser alteradas na prévia.');
  }
  return batch;
}

/** Decisão de uma linha (F3-06), dentro das permitidas para a situação dela. */
export const setRowDecision = defineUseCase({
  name: 'import.setRowDecision',
  access: 'lead.import',
  input: setRowDecisionInput,
  async run(ctx, input) {
    const batch = await requireReadyBatch(ctx, input.batchId);
    const row = await ctx.tx.importRow.findFirst({
      where: { id: input.rowId, batchId: batch.id },
      select: { id: true, matchStatus: true, matchedLeadId: true, matchReasons: true },
    });
    if (!row?.matchStatus) throw new NotFoundError('Linha não encontrada.');
    const allowed = allowedDecisions(row.matchStatus, {
      hasMatch: Boolean(row.matchedLeadId),
      matchedByCnpj: reasonsOf(row.matchReasons).some((m) => m.rule === 'CNPJ'),
    });
    if (!allowed.includes(input.decision)) {
      throw new ValidationError([
        { path: 'decision', message: 'Decisão não permitida para esta linha.' },
      ]);
    }
    await ctx.tx.importRow.update({ where: { id: row.id }, data: { decision: input.decision } });
    await ctx.tx.importBatch.update({
      where: { id: batch.id },
      data: { stats: toJson(await previewStats(ctx.tx, batch.id)) },
    });
    return { rowId: row.id, decision: input.decision };
  },
});

/** Mesma decisão para todas as linhas de uma situação, onde ela for permitida. */
export const setDecisionsByStatus = defineUseCase({
  name: 'import.setDecisionsByStatus',
  access: 'lead.import',
  input: setDecisionsByStatusInput,
  async run(ctx, input) {
    const batch = await requireReadyBatch(ctx, input.batchId);
    const rows = await ctx.tx.importRow.findMany({
      where: { batchId: batch.id, matchStatus: input.matchStatus },
      select: { id: true, matchedLeadId: true, matchReasons: true },
    });
    const ids = rows
      .filter((r) =>
        allowedDecisions(input.matchStatus, {
          hasMatch: Boolean(r.matchedLeadId),
          matchedByCnpj: reasonsOf(r.matchReasons).some((m) => m.rule === 'CNPJ'),
        }).includes(input.decision as ImportRowDecision),
      )
      .map((r) => r.id);
    for (let i = 0; i < ids.length; i += 5_000) {
      await ctx.tx.importRow.updateMany({
        where: { id: { in: ids.slice(i, i + 5_000) } },
        data: { decision: input.decision },
      });
    }
    await ctx.tx.importBatch.update({
      where: { id: batch.id },
      data: { stats: toJson(await previewStats(ctx.tx, batch.id)) },
    });
    return { changed: ids.length, unchanged: rows.length - ids.length };
  },
});
