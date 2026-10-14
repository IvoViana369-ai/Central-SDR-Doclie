import { createHash } from 'node:crypto';
import type { Prisma } from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import type { SpreadsheetReader } from '../../../ports/spreadsheet';
import { SpreadsheetError } from '../../../ports/spreadsheet';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/errors';
import {
  auditData,
  defineUseCase,
  type CoreDeps,
  type UseCaseContext,
} from '../../../shared/use-case';
import { createImportInput, importBatchIdInput, listImportsInput } from '../contracts/schemas';
import {
  detectHeaderRow,
  headerSignature,
  suggestMapping,
  type ColumnMapping,
} from '../domain/fields';

/** Linhas temporárias e lotes encerrados são apagados depois deste prazo (docs/LGPD.md §12). */
export const IMPORT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export const batchSummarySelect = {
  id: true,
  fileName: true,
  fileSize: true,
  fileType: true,
  encoding: true,
  delimiter: true,
  sheetName: true,
  sheetNames: true,
  headerRow: true,
  rowCount: true,
  status: true,
  duplicatePolicy: true,
  sourceId: true,
  sourceDetail: true,
  collectedAt: true,
  defaultLegalBasis: true,
  legalBasisAssessmentId: true,
  defaultOwnerId: true,
  defaultTagIds: true,
  mapping: true,
  stats: true,
  progress: true,
  error: true,
  createdAt: true,
  completedAt: true,
  fileSha256: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ImportBatchSelect;

export async function requireBatch(ctx: UseCaseContext, batchId: string) {
  const batch = await ctx.tx.importBatch.findUnique({
    where: { id: batchId },
    select: batchSummarySelect,
  });
  if (!batch) throw new NotFoundError('Importação não encontrada.');
  return batch;
}

/** Importação concluída do mesmo arquivo (M04: "o arquivo já foi importado"). */
async function previousImportOf(ctx: UseCaseContext, sha256: string, exceptId?: string) {
  const previous = await ctx.tx.importBatch.findFirst({
    where: {
      fileSha256: sha256,
      status: 'COMPLETED',
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, createdBy: { select: { name: true } } },
  });
  return previous
    ? { batchId: previous.id, completedAt: previous.completedAt, byName: previous.createdBy.name }
    : null;
}

/**
 * Recebe a planilha (F3-02): confere tamanho e extensão, guarda os bytes só
 * até a leitura no worker e avisa se o mesmo arquivo já foi importado.
 */
export const createImportBatch = defineUseCase({
  name: 'import.create',
  access: 'lead.import',
  input: createImportInput,
  async run(ctx, input) {
    const { maxBytes } = ctx.deps.importLimits;
    if (input.content.length === 0) {
      throw new ValidationError([{ path: 'file', message: 'O arquivo está vazio.' }]);
    }
    if (input.content.length > maxBytes) {
      throw new ValidationError([
        {
          path: 'file',
          message: `O arquivo passa do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        },
      ]);
    }
    if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const previousImport = await previousImportOf(ctx, sha256);
    const batch = await ctx.tx.importBatch.create({
      data: {
        fileName: input.fileName,
        fileSize: input.content.length,
        fileSha256: sha256,
        fileType: /\.xlsx$/i.test(input.fileName) ? 'XLSX' : 'CSV',
        sheetName: input.sheet ?? null,
        createdById: ctx.actor.id,
        file: { create: { content: Buffer.from(input.content) } },
      },
      select: { id: true },
    });
    await ctx.deps.jobs.enqueue(JOBS.importParse.name, { batchId: batch.id }, { tx: ctx.tx });
    await ctx.audit({
      action: 'import.upload',
      entityType: 'import_batch',
      entityId: batch.id,
      metadata: {
        fileName: input.fileName,
        fileSize: input.content.length,
        ...(previousImport ? { previousBatchId: previousImport.batchId } : {}),
      },
    });
    return { batchId: batch.id, previousImport };
  },
});

/**
 * Job `import.parse`: lê o arquivo no worker, grava as linhas (como texto) e
 * apaga os bytes na mesma transação. Arquivo recusado deixa o lote como
 * FAILED, com a mensagem para o usuário.
 */
export async function runImportParse(
  deps: CoreDeps,
  reader: SpreadsheetReader,
  job: { batchId: string },
): Promise<void> {
  const batch = await deps.db.importBatch.findUnique({
    where: { id: job.batchId },
    select: { id: true, status: true, fileName: true, sheetName: true, file: true },
  });
  if (!batch || batch.status !== 'UPLOADED') return;
  const fail = async (message: string) => {
    await deps.db.$transaction([
      deps.db.importFile.deleteMany({ where: { batchId: batch.id } }),
      deps.db.importBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED', error: message },
      }),
    ]);
  };
  if (!batch.file) return fail('O arquivo não foi encontrado. Envie de novo.');

  const { maxBytes, maxRows } = deps.importLimits;
  let sheet;
  try {
    // Margem para títulos acima do cabeçalho.
    sheet = reader.read(
      { fileName: batch.fileName, content: batch.file.content, sheet: batch.sheetName },
      { maxBytes, maxRows: maxRows + 50, timeoutMs: 120_000 },
    );
  } catch (error) {
    if (error instanceof SpreadsheetError) return fail(error.message);
    throw error;
  }
  const headerRow = detectHeaderRow(sheet.rows);
  const dataRows = sheet.rows.filter((r) => r.number > headerRow).length;
  if (dataRows > maxRows) {
    return fail(
      `A planilha passa do limite de ${maxRows.toLocaleString('pt-BR')} linhas. Divida o arquivo.`,
    );
  }
  if (dataRows === 0) return fail('A planilha não tem linhas abaixo do cabeçalho.');

  await deps.db.$transaction(
    async (tx) => {
      const CHUNK = 2_000;
      for (let i = 0; i < sheet.rows.length; i += CHUNK) {
        await tx.importRow.createMany({
          data: sheet.rows.slice(i, i + CHUNK).map((row) => ({
            batchId: batch.id,
            rowNumber: row.number,
            raw: row.cells,
          })),
        });
      }
      await tx.importFile.delete({ where: { batchId: batch.id } });
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: 'MAPPING',
          rowCount: dataRows,
          encoding: sheet.encoding,
          delimiter: sheet.delimiter,
          sheetName: sheet.sheetName,
          sheetNames: sheet.sheetNames,
          headerRow,
        },
      });
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
}

/**
 * Lote com o cabeçalho, as primeiras linhas e a sugestão de mapeamento (do
 * modelo salvo para o mesmo cabeçalho ou pelo nome das colunas).
 */
export const getImportBatch = defineUseCase({
  name: 'import.get',
  access: 'lead.import',
  input: importBatchIdInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    const firstRows = await ctx.tx.importRow.findMany({
      where: { batchId: batch.id },
      orderBy: { rowNumber: 'asc' },
      take: 15,
      select: { rowNumber: true, raw: true },
    });
    const rows = firstRows.map((r) => ({ number: r.rowNumber, cells: r.raw as string[] }));
    const header = rows.find((r) => r.number === batch.headerRow)?.cells ?? [];
    const width = Math.max(header.length, ...rows.map((r) => r.cells.length), 0);
    const headers = Array.from({ length: width }, (_, i) => header[i] || `Coluna ${i + 1}`);
    const template = header.length
      ? await ctx.tx.importMappingTemplate.findFirst({
          where: { headerSignature: headerSignature(headers) },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, name: true, mapping: true },
        })
      : null;
    const savedColumns = (batch.mapping as { columns?: ColumnMapping[] } | null)?.columns;
    const suggestion =
      savedColumns ?? (template?.mapping as ColumnMapping[] | undefined) ?? suggestMapping(headers);
    return {
      ...batch,
      fileSha256: undefined,
      previousImport: await previousImportOf(ctx, batch.fileSha256, batch.id),
      headers,
      sampleRows: rows,
      suggestedMapping: suggestion,
      templateUsed: !savedColumns && template ? { id: template.id, name: template.name } : null,
    };
  },
});

export const listImportBatches = defineUseCase({
  name: 'import.list',
  access: 'lead.import',
  input: listImportsInput,
  async run(ctx, input) {
    return ctx.tx.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        fileName: true,
        status: true,
        rowCount: true,
        stats: true,
        createdAt: true,
        completedAt: true,
        createdBy: { select: { name: true } },
      },
    });
  },
});

/** Cancela um lote que ainda não começou a gravar e apaga as linhas temporárias. */
export const cancelImportBatch = defineUseCase({
  name: 'import.cancel',
  access: 'lead.import',
  input: importBatchIdInput,
  async run(ctx, input) {
    const batch = await requireBatch(ctx, input.batchId);
    if (!['UPLOADED', 'MAPPING', 'PREVIEWING', 'PREVIEW_READY', 'FAILED'].includes(batch.status)) {
      throw new BusinessRuleError('Esta importação não pode mais ser cancelada.');
    }
    await ctx.tx.importRow.deleteMany({ where: { batchId: batch.id } });
    await ctx.tx.importFile.deleteMany({ where: { batchId: batch.id } });
    await ctx.tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'CANCELED',
        purgeAfter: new Date(ctx.now.getTime() + IMPORT_RETENTION_DAYS * DAY_MS),
      },
    });
    await ctx.audit({ action: 'import.cancel', entityType: 'import_batch', entityId: batch.id });
    return { batchId: batch.id, status: 'CANCELED' as const };
  },
});

/**
 * Job diário `import.purge`: apaga linhas temporárias vencidas (30 dias) e
 * cancela lotes abandonados há mais de 7 dias antes da gravação. O registro do
 * lote (contagens, sem dados pessoais) continua.
 */
export async function runImportPurge(
  deps: CoreDeps,
): Promise<{ purgedBatches: number; abandoned: number }> {
  const now = deps.clock.now();
  const abandonedBefore = new Date(now.getTime() - 7 * DAY_MS);
  const abandoned = await deps.db.importBatch.findMany({
    where: {
      status: { in: ['UPLOADED', 'MAPPING', 'PREVIEW_READY', 'FAILED'] },
      updatedAt: { lt: abandonedBefore },
    },
    select: { id: true },
  });
  for (const { id } of abandoned) {
    await deps.db.$transaction([
      deps.db.importFile.deleteMany({ where: { batchId: id } }),
      deps.db.importRow.deleteMany({ where: { batchId: id } }),
      deps.db.importBatch.update({ where: { id }, data: { status: 'CANCELED', purgeAfter: now } }),
    ]);
  }
  const expired = await deps.db.importBatch.findMany({
    where: { purgeAfter: { lt: now }, rows: { some: {} } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await deps.db.importRow.deleteMany({ where: { batchId: id } });
  }
  if (abandoned.length + expired.length > 0) {
    await deps.db.auditLog.create({
      data: auditData(
        { kind: 'system', name: 'import.purge' },
        {},
        {
          action: 'import.purge',
          entityType: 'import_batch',
          metadata: { purgedBatches: expired.length, abandoned: abandoned.length },
        },
      ),
    });
  }
  return { purgedBatches: expired.length, abandoned: abandoned.length };
}
