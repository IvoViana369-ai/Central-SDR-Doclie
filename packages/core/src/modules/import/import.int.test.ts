import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SpreadsheetError, type SpreadsheetReader } from '../../ports/spreadsheet';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import {
  commitImport,
  configureImport,
  createImportBatch,
  getImportBatch,
  getImportPreview,
  getImportReport,
  runImportCommit,
  runImportParse,
  runImportPreview,
  runImportPurge,
  setDecisionsByStatus,
  setRowDecision,
} from '.';

const { db, deps, enqueued, createActor } = createTestDeps();

/** Leitor de teste: CSV simples com ";" (o leitor real é testado no pacote de integrações). */
const reader: SpreadsheetReader = {
  read({ content }) {
    const text = new TextDecoder().decode(content);
    if (text.startsWith('CORROMPIDO'))
      throw new SpreadsheetError('CORRUPTED', 'Arquivo corrompido.');
    const rows = text
      .split('\n')
      .map((line, i) => ({ number: i + 1, cells: line.split(';').map((c) => c.trim()) }))
      .filter((r) => r.cells.some((c) => c !== ''));
    return {
      fileType: 'CSV',
      encoding: 'utf-8',
      delimiter: ';',
      sheetNames: [],
      sheetName: null,
      rows,
    };
  },
};

const SOBRAL = 2312908;
/** Planilha fictícia: título, cabeçalho na linha 2 e um caso de cada situação. */
const CSV = [
  'Lista fictícia de escritórios',
  'Nome;CNPJ;Telefone;E-mail;Cidade;UF;Obs',
  'Beta Assessoria;;(88) 99999-0002;beta@ficticio.example;Sobral;CE;nova', // 3: novo
  'Alfa Contábil;11.222.333/0001-81;;alfa2@ficticio.example;Sobral;CE;', // 4: já existe (CNPJ)
  'Gamma Contadores;;(88) 99999-0001;;Fortaleza;CE;', // 5: possível duplicado (telefone da Alfa)
  'Beta Assessoria;;88 99999 0002;;Sobral;CE;', // 6: repetido no arquivo
  'Delta Escritório;;(88) 98888-0004;;Sobral;CE;', // 7: na Lista Não Contatar
  ';;(88) 97777-0005;;Sobral;CE;', // 8: inválido (sem nome)
  'Épsilon Ltda;123;abc;nao-e-email;Bom Jesus;;', // 9: novo, com avisos
].join('\n');

describe('importação de planilha (M04)', () => {
  let manager: Actor;
  let sourceId: string;
  let alfaId: string;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  async function upload(content = CSV, fileName = 'leads-ficticios.csv') {
    const result = await createImportBatch(deps, manager, {
      fileName,
      content: new TextEncoder().encode(content),
    });
    await runImportParse(deps, reader, { batchId: result.batchId });
    return result;
  }

  async function configure(
    batchId: string,
    policy: 'CREATE_AND_FLAG' | 'SKIP' = 'CREATE_AND_FLAG',
  ) {
    const batch = await getImportBatch(deps, manager, { batchId });
    await configureImport(deps, manager, {
      batchId,
      headerRow: batch.headerRow,
      columns: batch.suggestedMapping,
      duplicatePolicy: policy,
      sourceId,
      collectedAt: '2026-10-05',
      legalBasis: 'LEGITIMATE_INTEREST',
      saveTemplateAs: 'Planilha de eventos',
    });
    await runImportPreview(deps, { batchId });
  }

  async function rowsByNumber(batchId: string) {
    const preview = await getImportPreview(deps, manager, { batchId, limit: 100 });
    return new Map(preview.data.map((r) => [r.rowNumber, r]));
  }

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor;
    alfaId = (
      await createLead(
        deps,
        manager,
        make('Alfa Contábil', {
          cnpj: '11222333000181',
          contactPoints: [{ type: 'PHONE', value: '(88) 99999-0001' }],
        }),
      )
    ).id;
    const delta = await createLead(
      deps,
      manager,
      make('Delta Antigo', { contactPoints: [{ type: 'PHONE', value: '(88) 98888-0004' }] }),
    );
    await registerOptOut(deps, manager, { leadId: delta.id });
    // Só os jobs do teste (o cadastro acima agenda a busca de duplicados).
    enqueued.length = 0;
  });

  afterAll(() => closeTestDb());

  it('lê no worker, acha o cabeçalho, sugere o mapeamento e descarta o arquivo', async () => {
    const { batchId, previousImport } = await upload();
    expect(previousImport).toBeNull();
    expect(enqueued.map((j) => j.name)).toEqual(['import.parse']);
    expect(await db.importFile.count()).toBe(0);
    const batch = await getImportBatch(deps, manager, { batchId });
    expect(batch).toMatchObject({ status: 'MAPPING', headerRow: 2, rowCount: 7 });
    expect(batch.suggestedMapping.map((m) => m.target)).toEqual([
      'tradeName',
      'cnpj',
      'phone',
      'email',
      'city',
      'state',
      'description',
    ]);
  });

  it('prévia: uma situação por caso, com motivos e avisos', async () => {
    const { batchId } = await upload();
    await configure(batchId);
    const rows = await rowsByNumber(batchId);
    expect(rows.get(3)).toMatchObject({ matchStatus: 'NEW', decision: 'IMPORT' });
    expect(rows.get(4)).toMatchObject({
      matchStatus: 'EXISTING',
      decision: 'LINK_EXISTING',
      matchedLead: { id: alfaId, code: 'L-000001' },
    });
    expect(rows.get(4)!.allowedDecisions).not.toContain('IMPORT');
    expect(rows.get(5)).toMatchObject({ matchStatus: 'POSSIBLE_DUPLICATE', decision: 'IMPORT' });
    expect(rows.get(5)!.matchReasons).toEqual([{ rule: 'PHONE', detail: '+55 88 9****-0001' }]);
    expect(rows.get(6)).toMatchObject({ matchStatus: 'DUPLICATE_IN_FILE', decision: 'SKIP' });
    expect(rows.get(7)).toMatchObject({ matchStatus: 'SUPPRESSED', decision: 'SKIP' });
    expect(rows.get(8)).toMatchObject({ matchStatus: 'INVALID', decision: 'SKIP' });
    expect(rows.get(9)).toMatchObject({ matchStatus: 'NEW' });
    expect(rows.get(9)!.warnings.length).toBe(4);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('PREVIEW_READY');
    expect(batch.stats).toMatchObject({
      byStatus: {
        NEW: 2,
        EXISTING: 1,
        POSSIBLE_DUPLICATE: 1,
        DUPLICATE_IN_FILE: 1,
        SUPPRESSED: 1,
        INVALID: 1,
      },
    });
    // O modelo de mapeamento ficou salvo.
    expect(await db.importMappingTemplate.count()).toBe(1);
  });

  it('decisões permitidas por linha e em grupo', async () => {
    const { batchId } = await upload();
    await configure(batchId);
    const rows = await rowsByNumber(batchId);
    await expect(
      setRowDecision(deps, manager, { batchId, rowId: rows.get(4)!.id, decision: 'IMPORT' }),
    ).rejects.toMatchObject({ issues: [{ message: 'Decisão não permitida para esta linha.' }] });
    await setRowDecision(deps, manager, {
      batchId,
      rowId: rows.get(4)!.id,
      decision: 'UPDATE_EXISTING',
    });
    const bulk = await setDecisionsByStatus(deps, manager, {
      batchId,
      matchStatus: 'POSSIBLE_DUPLICATE',
      decision: 'SKIP',
    });
    expect(bulk).toEqual({ changed: 1, unchanged: 0 });
  });

  it('confirma: cria, completa o existente, sinaliza duplicado e gera o relatório', async () => {
    const { batchId } = await upload();
    await configure(batchId);
    const rows = await rowsByNumber(batchId);
    await setRowDecision(deps, manager, {
      batchId,
      rowId: rows.get(4)!.id,
      decision: 'UPDATE_EXISTING',
    });
    await commitImport(deps, manager, { batchId });
    await runImportCommit(deps, { batchId });

    const report = await getImportReport(deps, manager, { batchId });
    expect(report.batch.status).toBe('COMPLETED');
    expect(report.batch.stats).toMatchObject({
      created: 3,
      updated: 1,
      linked: 0,
      errors: 0,
      suppressed: 1,
      invalid: 1,
      duplicatesFlagged: 1,
    });
    // Alfa ganhou o e-mail novo e a origem do lote, sem perder nada.
    const alfa = await db.lead.findUniqueOrThrow({
      where: { id: alfaId },
      include: { contactPoints: true, origins: true },
    });
    expect(alfa.contactPoints.map((c) => c.valueNormalized).sort()).toEqual([
      '+5588999990001',
      'alfa2@ficticio.example',
    ]);
    expect(alfa.origins.some((o) => o.importBatchId === batchId)).toBe(true);
    // Gamma (mesmo telefone da Alfa) foi criado e sinalizado para revisão.
    const gamma = await db.lead.findFirstOrThrow({ where: { displayName: 'Gamma Contadores' } });
    expect(gamma.createdVia).toBe('IMPORT');
    const candidate = await db.duplicateCandidate.findFirstOrThrow();
    expect([candidate.leadAId, candidate.leadBId].sort()).toEqual([alfaId, gamma.id].sort());
    expect(candidate).toMatchObject({
      detectedBy: 'IMPORT',
      status: 'PENDING',
      confidence: 'MEDIUM',
    });
    // Nada da Lista Não Contatar nem a linha sem nome virou lead.
    expect(await db.lead.count({ where: { displayName: 'Delta Escritório' } })).toBe(0);
    // Auditoria e retenção.
    expect(await db.auditLog.count({ where: { action: 'import.completed' } })).toBe(1);
    expect(report.batch.completedAt).not.toBeNull();
    const stored = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(stored.purgeAfter!.getTime() - stored.completedAt!.getTime()).toBe(30 * 86_400_000);
  });

  it('aceite M04: importar a mesma planilha de novo avisa e não cria duplicados', async () => {
    const first = await upload();
    await configure(first.batchId);
    await commitImport(deps, manager, { batchId: first.batchId });
    await runImportCommit(deps, { batchId: first.batchId });
    const leadsAfterFirst = await db.lead.count();

    const second = await upload();
    expect(second.previousImport).toMatchObject({ batchId: first.batchId });
    await configure(second.batchId);
    const stats = (await db.importBatch.findUniqueOrThrow({ where: { id: second.batchId } }))
      .stats as {
      byStatus: Record<string, number>;
    };
    expect(stats.byStatus.NEW ?? 0).toBe(0);
    await commitImport(deps, manager, { batchId: second.batchId });
    await runImportCommit(deps, { batchId: second.batchId });
    expect(await db.lead.count()).toBe(leadsAfterFirst);
  });

  it('arquivo recusado no worker deixa o lote como falho, com a mensagem', async () => {
    const { batchId } = await upload('CORROMPIDO');
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch).toMatchObject({ status: 'FAILED', error: 'Arquivo corrompido.' });
    expect(await db.importFile.count()).toBe(0);
  });

  it('SDR não importa; confirmar exige a prévia pronta', async () => {
    const { actor: sdr } = await createActor('SDR');
    await expect(
      createImportBatch(deps, sdr, { fileName: 'x.csv', content: new TextEncoder().encode(CSV) }),
    ).rejects.toThrow(ForbiddenError);
    const { batchId } = await upload();
    await expect(commitImport(deps, manager, { batchId })).rejects.toThrow(BusinessRuleError);
  });

  it('purga as linhas temporárias depois de 30 dias e cancela lotes abandonados', async () => {
    const done = await upload();
    await configure(done.batchId);
    await commitImport(deps, manager, { batchId: done.batchId });
    await runImportCommit(deps, { batchId: done.batchId });
    const abandoned = await upload(CSV, 'outro.csv');
    await db.importBatch.update({
      where: { id: done.batchId },
      data: { purgeAfter: new Date('2020-01-01') },
    });
    await db.$executeRaw`UPDATE import_batches SET updated_at = now() - interval '8 days' WHERE id = ${abandoned.batchId}::uuid`;

    const result = await runImportPurge(deps);
    expect(result).toEqual({ purgedBatches: 1, abandoned: 1 });
    expect(await db.importRow.count()).toBe(0);
    expect(
      (await db.importBatch.findUniqueOrThrow({ where: { id: abandoned.batchId } })).status,
    ).toBe('CANCELED');
    // Os leads importados continuam.
    expect(await db.lead.count({ where: { createdVia: 'IMPORT' } })).toBe(3);
  });
});
